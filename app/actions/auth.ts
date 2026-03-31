"use server";

export async function signInAction(email: string, password: string, callbackUrl: string) {
  const { signIn } = await import("@/auth");
  await signIn("credentials", { email, password, redirectTo: callbackUrl });
}

export async function signOutAction() {
  const { signOut } = await import("@/auth");
  await signOut({ redirectTo: "/" });
}
