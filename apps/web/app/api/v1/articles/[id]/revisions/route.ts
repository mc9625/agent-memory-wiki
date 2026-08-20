import { handleListRevisions, handleReviseArticle } from "../../../../../../lib/http/handlers";
import { getHttpServices } from "../../../../../../lib/http/runtime";

export const dynamic = "force-dynamic";

export const GET = async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => handleListRevisions((await context.params).id, request, await getHttpServices());

export const POST = async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => handleReviseArticle((await context.params).id, request, await getHttpServices());
