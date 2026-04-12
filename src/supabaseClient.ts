import { createClient } from '@supabase/supabase-js'

// Deze gegevens vind je in je Supabase dashboard (Settings > API)
const supabaseUrl = 'https://dzwfpdtqyiizjijndutk.supabase.co'
const supabaseKey = 'sb_publishable_H55xuQt9hl2OuKekTxbjbw_odPHcJX_'

export const supabase = createClient(supabaseUrl, supabaseKey)