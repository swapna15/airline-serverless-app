import { CloudWatchClient, GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";
import { ServiceQuotasClient, GetServiceQuotaCommand } from "@aws-sdk/client-service-quotas";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const region = process.env.BEDROCK_REGION || "us-east-1";
const modelId = "us.anthropic.claude-sonnet-4-6";

// Service Quotas quota code for Claude Sonnet cross-region tokens per minute
// L-* codes vary by model — we fetch the applied quota value
const QUOTA_CODE = "L-8F4B0A0E"; // Claude Sonnet cross-region tokens per minute

export async function GET() {
  try {
    const cwClient = new CloudWatchClient({ region });
    const sqClient = new ServiceQuotasClient({ region });

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);

    // Get token usage from CloudWatch for today
    const [inputMetric, outputMetric, quotaResult] = await Promise.allSettled([
      cwClient.send(new GetMetricStatisticsCommand({
        Namespace: "AWS/Bedrock",
        MetricName: "InputTokenCount",
        Dimensions: [{ Name: "ModelId", Value: modelId }],
        StartTime: startOfDay,
        EndTime: now,
        Period: 86400, // 1 day in seconds
        Statistics: ["Sum"],
      })),
      cwClient.send(new GetMetricStatisticsCommand({
        Namespace: "AWS/Bedrock",
        MetricName: "OutputTokenCount",
        Dimensions: [{ Name: "ModelId", Value: modelId }],
        StartTime: startOfDay,
        EndTime: now,
        Period: 86400,
        Statistics: ["Sum"],
      })),
      sqClient.send(new GetServiceQuotaCommand({
        ServiceCode: "bedrock",
        QuotaCode: QUOTA_CODE,
      })),
    ]);

    const inputTokens = inputMetric.status === "fulfilled"
      ? (inputMetric.value.Datapoints?.[0]?.Sum ?? 0)
      : 0;

    const outputTokens = outputMetric.status === "fulfilled"
      ? (outputMetric.value.Datapoints?.[0]?.Sum ?? 0)
      : 0;

    const quotaValue = quotaResult.status === "fulfilled"
      ? quotaResult.value.Quota?.Value ?? null
      : null;

    return NextResponse.json({
      model: modelId,
      today: {
        inputTokens: Math.round(inputTokens),
        outputTokens: Math.round(outputTokens),
        totalTokens: Math.round(inputTokens + outputTokens),
      },
      quota: {
        tokensPerMinute: quotaValue,
        unit: "tokens/minute",
      },
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
