---
title: 'Account security'
description: 'Change your password and manage account credentials.'
locale: en
slug: settings-security
section: account
order: 3
---

# Account security

Manage the credentials that protect your RankMeFast account from **Settings → Security** (URL: `/settings/security`).

## Change your password

1. Sign in and open **Settings → Security**.
2. Fill in your **current password**, then choose a **new password** and confirm it. The new password must be at least eight characters and must differ from the current one.
3. Click **Update password**.

We store only a scrypt hash of your password, so we never see it in plain text. When you change your password successfully:

- Every **other** active session for your account is signed out. The device you used to change the password stays signed in.
- We send a confirmation email to the address on your account. If you did not change the password, that email is your signal to reset your password immediately via [the forgot-password flow](./getting-started.en.md).

If the current password you entered is wrong, we say so next to the field. We never reveal whether an account exists for a given email.

## Change your email

1. Sign in and open **Settings → Security**.
2. Enter the **new email** address in the *Change email* card. It must be different from your current one.
3. Click **Send verification link**.

We send a confirmation link to the **new** address. Your account email only changes after you follow that link:

- Your **current email keeps working** for sign-in until you confirm.
- If the new address is already registered to another account, we reject the change with a generic *email unavailable* message and don't say who owns that address.
- The link is single-use and expires after a short window; request another change from the same page if it lapses.

## Forgot your current password?

If you cannot remember your current password, sign out and use **Forgot password?** on the login screen. The emailed link takes you to a page where you can pick a new password without confirming the old one.

## Two-factor authentication

Add a second step at sign-in so a stolen password alone cannot get into your account.

### Enable two-factor

1. Sign in and open **Settings → Security**.
2. In the **Two-factor authentication** card, enter your current password and click **Enable two-factor**.
3. Scan the QR code with an authenticator app like 1Password, Authy, or Google Authenticator, or paste the manual-entry code into the app.
4. Copy or download the **backup codes**. Each code works exactly once. They are the only way back into your account if you lose your device.
5. Enter the six-digit code your authenticator app is showing right now and click **Verify and turn on**.

Once enabled, every sign-in asks for a fresh code from your authenticator (or a one-time backup code).

### Disable two-factor

Open the same card, click **Disable two-factor**, and enter your current password. We turn the feature off immediately.

### Admin accounts

If your account has the **Admin** role, two-factor authentication is required. You will not be able to open the admin panel until you enable it from **Settings → Security**.

### Lost your device

Use one of your backup codes on the sign-in challenge screen. The same screen has a **Use a backup code** link. Each code works once; if you run out, an admin on your team can reset the second factor from the admin panel.

## Your data rights

You can request an export or deletion of your account data. The export covers only the datasets in the generated file. It leaves out Pages snapshots and your GSC and rank history. Deletion goes further: after the grace period, it removes all stored account data, including data the export doesn't contain. You can cancel the deletion request during that window. See [Page performance](./pages-performance.en.md) for how long Pages data is kept.
