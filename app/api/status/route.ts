import { ehLocal, verificarAcesso } from "@/lib/servidor/acesso";
import { BRITECH_URL, britechConfigurada, CHAVE_ACESSO, DRIVE_BASE_PADRAO } from "@/lib/servidor/config";
import { driveDisponivel } from "@/lib/servidor/drive-local";

/** O que está disponível neste servidor (sem segredos). Sem acesso liberado, só diz que a chave é necessária. */
export async function GET(req: Request) {
  const local = ehLocal(req);
  const liberado = verificarAcesso(req) === null;
  return Response.json({
    local,
    exigeChave: !local,
    chaveConfigurada: !!CHAVE_ACESSO,
    liberado,
    drive: liberado ? { disponivel: await driveDisponivel(), base: DRIVE_BASE_PADRAO } : { disponivel: false, base: "" },
    britech: liberado ? { configurada: britechConfigurada(), url: BRITECH_URL } : { configurada: false, url: "" },
  });
}
