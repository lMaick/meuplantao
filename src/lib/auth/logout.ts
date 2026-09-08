type SignOut = () => Promise<{ error: unknown } | undefined>;

export async function logoutAndRedirect(signOut: SignOut, redirect: (path: string) => void): Promise<boolean> {
  try {
    const result = await signOut();
    if (result?.error) return false;
    redirect("/login");
    return true;
  } catch {
    return false;
  }
}
