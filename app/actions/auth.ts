"use server";

import { signIn, signOut } from "@/auth";

export async function signInAction(email: string, password: string, callbackUrl: string) {
  await signIn("credentials", { email, password, redirectTo: callbackUrl });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
