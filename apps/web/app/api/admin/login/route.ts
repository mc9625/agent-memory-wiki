import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSessionToken, verifyPassword } from "../../../../lib/admin-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body as { password?: string };
    if (!password || !verifyPassword(password)) {
      return NextResponse.json(
        { error: "Invalid admin password" },
        { status: 401 }
      );
    }

    const token = createSessionToken();
    const cookieStore = await cookies();
    cookieStore.set("amw_admin_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Bad request" },
      { status: 400 }
    );
  }
}
