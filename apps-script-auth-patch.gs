/* ============================================================
   Apps Script-এ যোগ করার প্যাচ (ঐচ্ছিক, per-user সিঙ্কের জন্য)
   অ্যাপ এখন প্রতিটি অনুরোধে idToken (Google ID token) পাঠায়।
   ============================================================ */
const GOOGLE_CLIENT_ID = 'PASTE_YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const OWNER_EMAIL = 'shohelrana2410@gmail.com'; // বর্তমান Sheet যার

// টোকেন যাচাই করে verified ইমেইল ফেরত দেয় (ব্যর্থ হলে null)
function verifyUser_(idToken) {
  if (!idToken) return null;
  try {
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const info = JSON.parse(res.getContentText());
    if (info.aud !== GOOGLE_CLIENT_ID || info.email_verified !== 'true') return null;
    return info.email;
  } catch (e) { return null; }
}

/* doGet / doPost-এর শুরুতে:
     const body = (e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : {};
     const email = verifyUser_((e.parameter && e.parameter.idToken) || body.idToken);
     if (!email) return json_({ success: false, error: 'unauthorized' });
     // বর্তমান Sheet শুধু OWNER_EMAIL-এর জন্য; অন্যদের জন্য আলাদা Spreadsheet/Sheet বেছে নিন
     if (email !== OWNER_EMAIL) { ... ইউজার-ভিত্তিক শিট ... }
   তারপর common.js-এ SYNC_NON_OWNERS: true করুন। */
