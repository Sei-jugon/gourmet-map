// 保存先(Supabase)への接続先。
// ここに書くのは「公開用の鍵(publishable key)」だけ。アプリに入れて使う前提の鍵で、
// 見られる範囲は保存先側の決まり(supabase/setup.sql)で守る。施主了承済み(2026-10-05)。
// 「秘密の鍵(管理者用の鍵)」とデータベースのパスワードは、絶対にここに書かない。

export const SUPABASE_URL = 'https://djydxqhcsbpcjnootlvf.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_3SBWRpYsL0dcudDmnWOrhg_lH5KEP21';
