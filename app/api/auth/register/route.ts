import { createUser } from "@/lib/db";
import { isValidEmail, isValidName } from "@/lib/validation";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, email, password } = body;

  if (!name || !email || !password) {
    return NextResponse.json({ message: "name, email, and password are required." }, { status: 400 });
  }
  if (!isValidName(name)) {
    return NextResponse.json({ message: "Name must be a non-empty string up to 100 characters." }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ message: "Invalid email address." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ message: "Password must be at least 8 characters." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await createUser({ name, email, passwordHash });

  if (!result.user) {
    const isInfra = result.message?.includes("not available");
    return NextResponse.json(
      { message: result.message },
      { status: isInfra ? 503 : 409 }
    );
  }

  return NextResponse.json({ message: "Account created successfully." }, { status: 201 });
}
