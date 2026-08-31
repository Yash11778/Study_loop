import { Resend } from "resend";
import { env, isProd } from "@/config/env";
import { logger } from "@/utils/logger";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

if (!resend) logger.warn("RESEND_API_KEY unset -- emails will be logged, not sent.");

type Mail = { to: string; subject: string; html: string; text: string };

async function send(mail: Mail): Promise<{ id: string | null }> {
  if (!resend) {
    logger.info({ to: mail.to, subject: mail.subject }, "email (not sent -- no API key)");
    return { id: null };
  }

  const { data, error } = await resend.emails.send({
    from: env.RESEND_FROM,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  // Resend reports failures in the body rather than by throwing.
  if (error) throw new Error(`resend: ${error.message}`);
  return { id: data?.id ?? null };
}

/** Inlined styles: every mail client strips <style> blocks. */
const shell = (title: string, body: string) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dce1e8;border-radius:8px;padding:32px">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#146b7f;font-weight:700">Study Loop</p>
    <h1 style="margin:0 0 16px;font-size:22px;color:#16202e">${title}</h1>
    ${body}
  </div>
</div>`;

export async function sendLoginCode(to: string, code: string) {
  return send({
    to,
    subject: `${code} is your Study Loop sign-in code`,
    text: `Your sign-in code is ${code}. It expires in 10 minutes.`,
    html: shell(
      "Your sign-in code",
      `<p style="margin:0 0 20px;color:#35455a;font-size:15px">Enter this code to sign in. It expires in 10 minutes.</p>
       <p style="margin:0;font-size:34px;font-weight:700;letter-spacing:.28em;color:#16202e;font-family:ui-monospace,monospace">${code}</p>
       <p style="margin:24px 0 0;color:#5c6b7f;font-size:13px">If you didn't ask for this, you can ignore it.</p>`
    ),
  });
}

export async function sendResultEmail(args: {
  to: string;
  score: number;
  bandLabel: string;
  weakest: Array<{ label: string; mastery: number }>;
  resultId: string;
}) {
  const url = `${env.APP_URL}/results/${args.resultId}`;

  const rows = args.weakest
    .map(
      (c) =>
        `<tr><td style="padding:6px 0;color:#35455a;font-size:14px">${c.label}</td>
         <td style="padding:6px 0;text-align:right;color:#16202e;font-weight:600;font-size:14px">${Math.round(c.mastery * 100)}%</td></tr>`
    )
    .join("");

  return send({
    to: args.to,
    subject: `Your quiz result: ${args.score}%`,
    text:
      `You scored ${args.score}% (${args.bandLabel}).\n\n` +
      `Weakest concepts:\n${args.weakest.map((c) => `- ${c.label}: ${Math.round(c.mastery * 100)}%`).join("\n")}\n\n` +
      `Full breakdown: ${url}`,
    html: shell(
      `You scored ${args.score}%`,
      `<p style="margin:0 0 20px;color:#35455a;font-size:15px">That puts you at <strong style="color:#16202e">${args.bandLabel}</strong>.</p>
       <p style="margin:0 0 8px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#5c6b7f;font-weight:700">Worth another look</p>
       <table style="width:100%;border-collapse:collapse;margin:0 0 24px">${rows}</table>
       <a href="${url}" style="display:inline-block;background:#146b7f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600;font-size:14px">See the full breakdown</a>`
    ),
  });
}
