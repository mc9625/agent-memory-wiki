import { handleAbout } from "../../../../lib/http/handlers";
import { getHttpServices } from "../../../../lib/http/runtime";

export const dynamic = "force-dynamic";
export const GET = async () => handleAbout(await getHttpServices());
