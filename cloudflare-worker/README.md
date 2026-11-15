# ShiftFlow Cloudflare Worker + D1

این پوشه شامل نسخه مستقل **Cloudflare Worker** به همراه دیتابیس **Cloudflare D1**، سیستم **اسنپ‌شات و بکاپ خودکار روزانه (Cron)** و پشتیبانی از **WebSocket لحظه‌ای (Durable Objects)** است.

## ۱. ساخت دیتابیس D1 و استقرار با Wrangler CLI

```bash
cd cloudflare-worker

# لاگین در اکانت کلودفلر (در صورت نیاز)
npx wrangler login

# ساخت دیتابیس D1
npx wrangler d1 create shiftflow-db

# جایگزینی database_id خروجی در فایل wrangler.toml، سپس ساخت جداول:
npx wrangler d1 execute shiftflow-db --remote --file=./schema.sql

# دیپلوی Worker + فعال‌سازی Cron خودکار روزانه
npx wrangler deploy
```

> **نکته:** اگر از طریق **داشبورد کلودفلر (بدون Wrangler)** دیتابیس D1 را بسازید و به Worker متصل (Bind) کنید، نام متغیر را `DB` بگذارید. تمام جداول (از جمله `roster_snapshots`) به‌صورت خودکار در اولین درخواست ایجاد می‌شوند.

## ۲. قابلیت‌های اضافه‌شده روی کلودفلر

1. **بکاپ و بازگردانی (D1 Snapshots):**
   - هر شب ساعت `00:00` و `07:00` به وقت تهران (با تنظیم Cron Trigger در داشبورد یا `wrangler.toml`) بکاپ خودکار گرفته می‌شود.
   - پیش از هر ریست کامل (`POST /api/sync/reset`) یا بازگردانی (`POST /api/sync/restore`)، یک **اسنپ‌شات ایمنی خودکار** ثبت می‌شود.
   - از تب «پشتیبان‌گیری و انتقال داده» داخل پنل می‌توانید اسنپ‌شات دستی بگیرید یا به هر نسخه قبلی برگردید.
2. **گزارش خودکار تلگرام (اختیاری):**
   - اگر متغیرهای `TELEGRAM_BOT_TOKEN` و `TELEGRAM_CHAT_ID` را در بخش **Secrets** ورکر تنظیم کنید، کرون ساعت ۷ صبح خلاصه شیفت روز/شب/آنکال را به تلگرام می‌فرستد.
3. **امنیت نوشتن (اختیاری):**
   - با تنظیم Secret با نام `SYNC_WRITE_SECRET` روی Worker و تنظیم `VITE_SYNC_WRITE_SECRET` هنگام Build، فقط درخواست‌های دارای هدر معتبر مجاز به تغییر داده خواهند بود.
4. **WebSocket هم‌زمان (اختیاری - پلن رایگان Durable Objects):**
   - با باز کردن کامنت بخش `[[durable_objects.bindings]]` در `wrangler.toml` و دیپلوی مجدد، تمام مرورگرها به‌صورت خودکار تغییر شیفت را زیر ۵۰ میلی‌ثانیه بدون Polling دریافت می‌کنند.
