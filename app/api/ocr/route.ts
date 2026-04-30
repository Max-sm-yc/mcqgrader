import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { image, startQuestion } = await request.json();

    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY not configured" },
        { status: 500 }
      );
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "baidu/qianfan-ocr-fast:free",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `This is an image of a multiple choice exam answer sheet. Extract ONLY the CIRCLED answers for each question.

IMPORTANT: Students mark their answer by drawing a CIRCLE around the letter. A cross (X) on a letter means it is NOT the answer - it was crossed out or eliminated. Only report letters that have a CIRCLE drawn around them.

Return the answers in this exact format, one per line:
Q${startQuestion}: X
Q${startQuestion + 1}: X
...

Where X is the letter (A, B, C, D, etc.) that has a CIRCLE around it.
If a question has no circled answer (only crossed-out letters or no marking), skip that line.
Do NOT include any explanation, just the answers in the format above.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: image,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[v0] OpenRouter API error:", errorText);
      return NextResponse.json(
        { error: "OCR API request failed" },
        { status: response.status }
      );
    }

    const data = await response.json();
    const ocrText = data.choices?.[0]?.message?.content || "";

    return NextResponse.json({ text: ocrText });
  } catch (error) {
    console.error("[v0] OCR processing error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OCR processing failed" },
      { status: 500 }
    );
  }
}
