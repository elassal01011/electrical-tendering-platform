type SignIn = (
  provider: string,
  options: { redirect: false; identifier: string; password: string },
) => Promise<{ ok?: boolean } | undefined>;
export async function finishSignup(
  result: { pendingApproval: boolean },
  identifier: string,
  password: string,
  signIn: SignIn,
) {
  if (result.pendingApproval) return "/login?pending=1";
  try {
    const response = await signIn("credentials", {
      redirect: false,
      identifier,
      password,
    });
    return response?.ok ? "/dashboard" : "/login?registered=1";
  } catch {
    return "/login?registered=1";
  }
}
