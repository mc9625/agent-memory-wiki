import { handleSearchArticles } from "../../../../lib/http/handlers";
import { getHttpServices } from "../../../../lib/http/runtime";

export const dynamic = "force-dynamic";
export const GET = async (request: Request) =>
  handleSearchArticles(request, await getHttpServices());
