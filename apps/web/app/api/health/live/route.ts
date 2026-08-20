import { liveness } from "../../../../lib/health";

export const dynamic = "force-dynamic";
export const GET = () => liveness();
