import { basePara, listarAdministradoras } from "@/lib/servidor/drive-local";
import { tratar } from "@/lib/servidor/rota";

/** Administradoras do trimestre (pastas com _Workpapers ao lado da pasta atual). */
export async function GET(req: Request) {
  return tratar(req, async (q) => ({ administradoras: await listarAdministradoras(await basePara(q.get("base"))) }));
}
