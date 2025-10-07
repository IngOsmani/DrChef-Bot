import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

// === Config ===
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// --- Root check
app.get("/", (_req, res) => {
  res.status(200).send("Dr&Chef bot OK");
});

// --- Verificación de webhook (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Recepción de mensajes (POST)
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    if (body.object !== "page") return res.sendStatus(404);

    for (const entry of body.entry || []) {
      const event = entry.messaging?.[0];
      if (!event) continue;

      const senderId = event.sender?.id;
      let userText =
        event.message?.text ||
        event.postback?.payload ||
        "";

      if (!senderId) continue;

      // Generar respuesta con OpenAI
      const reply = await generateReply(userText);

      // Enviar respuesta a Messenger
      await sendMessage(senderId, reply);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Error en /webhook:", err);
    return res.sendStatus(500);
  }
});

// === Funciones auxiliares ===
async function generateReply(userText) {
  // Instrucción base para el bot de Dr&Chef
  const systemPrompt = `
Eres el asistente de Dr&Chef Uniformes (Monterrey).
Responde de forma amable, profesional y breve.
Prioriza:
1) Dirección completa: Francisco I. Madero 3195 Pte., Local C, Monterrey, N.L. (entrada por calle Dr. Eduardo Aguirre Pequeño, frente a facultad de medicina).
2) WhatsApp y llamadas: 81 8111 6026
3) Llamadas (fijo): 81 2089 4494
4) Web: uniformesdoctorychef.com.mx (solo para ver productos; ventas en tienda).
5) Promoción (si preguntan por precios o interés): “🎉 Promoción especial: ✅ 10% de descuento ✅ Envío al 50% al mencionar dónde viste esta publicación”.
6) Si piden cotización o precio, invita a WhatsApp con el link: http://wa.me/8181116026
No inventes disponibilidad. No prometas envíos fuera de lo permitido por la tienda.
  `.trim();

  const userPrompt = `Usuario dice: "${userText}". Redacta una respuesta útil y concreta.`;

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: `${systemPrompt}\n\n${userPrompt}`
      })
    });

    const data = await r.json();

    // La API de "responses" expone "output_text" con el texto plano
    const candidate =
      data?.output_text ||
      data?.choices?.[0]?.message?.content ||
      "Gracias por escribir a Dr&Chef Uniformes. Escríbenos por WhatsApp: 81 8111 6026.";

    return truncate(candidate, 635); // Límite de texto de Messenger
  } catch (e) {
    console.error("OpenAI error:", e);
    return "Gracias por escribir a Dr&Chef Uniformes. Escríbenos por WhatsApp: 81 8111 6026.";
  }
}

function truncate(str, n) {
  return (str && str.length > n) ? `${str.slice(0, n - 1)}…` : str;
}

async function sendMessage(psid, text) {
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  const payload = {
    recipient: { id: psid },
    message: { text }
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const errText = await r.text();
    console.error("Messenger send error:", r.status, errText);
  }
}

// === Start server ===
app.listen(PORT, () => {
  console.log(`Dr&Chef bot activo en puerto ${PORT}`);
});