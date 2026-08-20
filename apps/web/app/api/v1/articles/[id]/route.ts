import { handleGetArticle } from "../../../../../lib/http/handlers";
import { getHttpServices } from "../../../../../lib/http/runtime";

export const dynamic = "force-dynamic";

export const GET = async (
  _request: Request,
  context: { params: Promise<{ id: string }> },
) => handleGetArticle((await context.params).id, await getHttpServices());
