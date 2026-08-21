export const LOCAL_DASHBOARD_HOST = "127.0.0.1";
export const LOCAL_DASHBOARD_PORT = 4317;

export const localDashboardListenOptions = (): { readonly host: string; readonly port: number } => ({
  host: LOCAL_DASHBOARD_HOST,
  port: LOCAL_DASHBOARD_PORT,
});

export const isAllowedHost = (host: string | undefined): boolean =>
  host === `${LOCAL_DASHBOARD_HOST}:${LOCAL_DASHBOARD_PORT}`;
