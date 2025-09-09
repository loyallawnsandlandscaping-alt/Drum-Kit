
import { supabase } from "./supabase";

export async function findPendingForMe() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.email) return null;

  const { data, error: selErr } = await supabase
    .from('calls').select('*')
    .eq('status','pending')
    .eq('callee_email', user.email)
    .order('created_at', { ascending: false })
    .limit(1);

  if (selErr) throw selErr;
  return data?.[0] || null;
}
