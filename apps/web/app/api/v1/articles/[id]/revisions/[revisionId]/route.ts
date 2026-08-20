import { handleGetRevision } from "../../../../../../../lib/http/handlers";
import { getHttpServices } from "../../../../../../../lib/http/runtime";

export const dynamic = "force-dynamic";
export const GET = async (
  _request: Request,
  context: { params: Promise<{ id: string; revisionId: string }> },
) => {
  const params = await context.params;
  return handleGetRevision(params.id, params.revisionId, await getHttpServices());
};
