import { ehLocal, verificarAcesso } from "@/lib/servidor/acesso";
import { BRITECH_URL, CHAVE_ACESSO, DRIVE_BASE_PADRAO, instanciasBritech } from "@/lib/servidor/config";
import { driveDisponivel } from "@/lib/servidor/drive-local";
import { instanciasFromtis } from "@/lib/servidor/fromtis";
import { mondayConfigurado } from "@/lib/servidor/monday";
import { instanciasSinqia } from "@/lib/servidor/sinqia";

/** O que está disponível neste servidor (sem segredos). Sem acesso liberado, só diz que a chave é necessária. */
export async function GET(req: Request) {
  const local = ehLocal(req);
  const liberado = verificarAcesso(req) === null;
  const britech = liberado ? instanciasBritech().map((i) => ({ adm: i.adm, nome: i.nome })) : [];
  const fromtis = liberado ? instanciasFromtis().map((i) => ({ adm: i.adm, nome: i.nome })) : [];
  const sinqia = liberado ? instanciasSinqia().map((i) => ({ adm: i.adm, nome: i.nome })) : [];
  return Response.json({
    local,
    exigeChave: !liberado || (!local && !!CHAVE_ACESSO && !!req.headers.get("x-lastro-chave")),
    chaveConfigurada: !!CHAVE_ACESSO,
    liberado,
    drive: liberado ? { disponivel: await driveDisponivel(), base: DRIVE_BASE_PADRAO } : { disponivel: false, base: "" },
    britech: { configurada: britech.length > 0, url: liberado ? BRITECH_URL : "", administradoras: britech },
    fromtis: { administradoras: fromtis },
    sinqia: { administradoras: sinqia },
    monday: { configurado: liberado && mondayConfigurado() },
  });
}
