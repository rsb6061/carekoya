-- Company-email employers used to be approved automatically; now only an agency or care-community domain on record is.
-- Employers who already had access that way keep it, recorded as an approval so nobody is locked out mid-pilot.
UPDATE employer_leads SET approved_at=CURRENT_TIMESTAMP,approved_by='company_email_before_2026_10_09',updated_at=CURRENT_TIMESTAMP
  WHERE approved_at IS NULL AND status!='disabled' AND instr(email,'@')>0
    AND lower(substr(email,instr(email,'@')+1)) NOT IN ('gmail.com','googlemail.com','yahoo.com','ymail.com','hotmail.com','outlook.com','live.com','msn.com','aol.com',
      'icloud.com','me.com','mac.com','comcast.net','verizon.net','att.net','sbcglobal.net','protonmail.com','proton.me','gmx.com','mail.com','zoho.com');
