import { handleCreateArticle, handleListArticles } from "../../../../lib/http/handlers";
import { getHttpServices } from "../../../../lib/http/runtime";

export const dynamic = "force-dynamic";

export const GET = async (request: Request) => handleListArticles(request, await getHttpServices());
export const POST = async (request: Request) => handleCreateArticle(request, await getHttpServices());
