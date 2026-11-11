import { composicaoCarteira } from "@/lib/servidor/britech";
import { ErroDrive } from "@/lib/servidor/drive-local";
import { obrigatorio, tratar } from "@/lib/servidor/rota";

export const maxDuration = 120;

/** Relatório Composição da Carteira (Excel alinhado) da Britech na data-base. */
export async function GET(req: Request) {
  return tratar(req, async (q) => {
    const id = obrigatorio(q, "id", "o ID da carteira").replace(/\D/g, "");
    const data = obrigatorio(q, "data", "a data-base");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroDrive("Data-base inválida (use aaaa-mm-dd).");
    const bytes = await composicaoCarteira(id, data);
    return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="carteira_${id}_${data}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  });
}
