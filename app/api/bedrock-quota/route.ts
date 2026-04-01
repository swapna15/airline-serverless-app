import { CloudWatchClient, GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";
import { ServiceQuotasClient, GetServiceQuotaCommand } from "@aws-sdk/client-service-quotas";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const region = process.env.BEDROCK_REGION || "us-east-1";

// Try both the cross-region profile ID and the base model ID
const MODEL_IDS = [
  "us.amazon.nova-micro-v1:0",
  "amazon.nova-micro-v1:0",
];

const QUOTA_CODE = "L-8F4B0A0E";

async function getTokenMetric(cwClient: CloudWatchClient, metricName: string, startTime: Date, endTime: Date) {
  let total = 0;
  for (const modelId of MODEL_IDS) {
    try {
      const result = await cwClient.send(new GetMetricStatisticsCommand({
        Namespace: "AWS/Bedrock",
        MetricName: metricName,
        Dimensions: [{ Name: "ModelId", Value: modelId }],
        StartTime: startTime,
        EndTime: endTime,
        Period: 86400,
        Statistics: ["Sum"],
      }));
      total += result.Datapoints?.[0]?.Sum ?? 0;
    } catch { /* skip */ }
  }
  return total;
}

export async function GET() {
  try {
    const cwClient = new CloudWatchClient({ region });
    const sqClient = new ServiceQuotasClient({ region });

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [inputTokens, outputTokens, quotaResult] = await Promise.all([
      getTokenMetric(cwClient, "InputTokenCount", startOfDay, now),
      getTokenMetric(cwClient, "OutputTokenCount", startOfDay, now),
      sqClient.send(new GetServiceQuotaCommand({
        ServiceCode: "bedrock",
        QuotaCode: QUOTA_CODE,
      })).catch(() => null),
    ]);

    const quotaValue = quotaResult?.Quota?.Value ?? null;

    return NextResponse.json({
      model: MODEL_IDS[0],
      today: {
        inputTokens: Math.round(inputTokens),
        outputTokens: Math.round(outputTokens),
        totalTokens: Math.round(inputTokens + outputTokens),
      },
      quota: {
        tokensPerMinute: quotaValue,
        unit: "tokens/minute",
      },
      note: inputTokens === 0 ? "CloudWatch metrics have a ~15 min delay. Values may be 0 if usage was recent." : null,
      resetAt: new Date(startOfDay.getTime() + 86400000).toISOString(),
    });
  } catch (err) {
    console.error("[bedrock-quota] error:", err);
    return NextResponse.json(
      { error: "Could not retrieve quota information." },
      { status: 500 }
    );
  }
}
