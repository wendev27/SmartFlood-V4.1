import { NextRequest, NextResponse } from "next/server";
import { getSensorWeather } from "@/server/weather";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lng = Number(request.nextUrl.searchParams.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ success: false, error: "Valid sensor coordinates are required." }, { status: 400 });
  }

  try {
    const data = await getSensorWeather(lat, lng);
    return NextResponse.json({ success: true, data }, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Weather is temporarily unavailable. Please retry shortly." },
      { status: 503 },
    );
  }
}
