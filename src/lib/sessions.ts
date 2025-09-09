import { supabase } from "./supabase";

export async function signInEmailLink() {
  const email = prompt("Enter your email to sign in:");
  if (!email) return;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  });
  if (error) alert("Sign-in error: " + error.message);
  else alert("Check your email for the magic link.");
}

export async function signOutAll() {
  await supabase.auth.signOut();
}

export function onAuth(cb: (user: any) => void) {
  supabase.auth.getUser().then(({ data }) => cb(data.user ?? null));
  return supabase.auth.onAuthStateChange((_e, s) => cb(s?.user ?? null));
}
