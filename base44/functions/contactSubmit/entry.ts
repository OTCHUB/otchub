// Public contact-form endpoint for the Contact page. Visitors are not logged
// in, so the record is stored via the service role; every field is validated
// and hard-bounded to keep the endpoint safe for anonymous input.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function (req) {
  try {
    const client = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim().slice(0, 120);
    const email = String(body.email || "").trim().slice(0, 254);
    const message = String(body.message || "").trim().slice(0, 4000);
    if (!name || !message) {
      return Response.json({ error: "Name and message are required" }, { status: 400 });
    }
    if (email && !EMAIL_RE.test(email)) {
      return Response.json({ error: "Invalid email address" }, { status: 400 });
    }
    await client.asServiceRole.entities.ContactMessage.create({ name, email, message });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e?.message || "Failed to send" }, { status: 500 });
  }
}