import "./config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const hasPlaceholder =
  String(window.SUPABASE_URL).includes("YOUR_PROJECT") ||
  String(window.SUPABASE_ANON_KEY).includes("YOUR_SUPABASE_ANON_KEY");

if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || hasPlaceholder) {
  throw new Error(
    "Configura SUPABASE_URL y SUPABASE_ANON_KEY en app/js/config.local.js antes de iniciar la app."
  );
}

export const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
