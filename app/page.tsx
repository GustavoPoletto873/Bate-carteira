import { Conferencia } from "@/components/conferencia/conferencia";
import { PrismaHero, WordsPullUp } from "@/components/ui/prisma-hero";

const PASSOS = [
  {
    n: "01",
    titulo: "Carteira Britech",
    texto: "Cada título com emissor e datas: VL Aplic., Dt. Emissão, Dt. Vencimento e Emissor.",
  },
  {
    n: "02",
    titulo: "WP_Termo",
    texto: "O valor de aquisição e as datas do workpaper precisam bater com a Britech, linha a linha.",
  },
  {
    n: "03",
    titulo: "Documentos",
    texto:
      "Boletins, termos, TCNC, boletas e telas CETIP: o app acha o documento de cada título e mostra o trecho que confirma — ou que diverge.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-background p-2 sm:p-3">
      <PrismaHero
        title="Lastro"
        description="Bate a carteira Britech com o workpaper e com os documentos de lastro e termo do fundo: VL Aplic., datas de emissão e vencimento e emissor, título a título. Tudo roda no seu navegador — os arquivos do fundo não saem do seu computador."
        ctaLabel="Começar conferência"
        ctaHref="#fontes"
        navItems={[
          { label: "Como funciona", href: "#como-funciona" },
          { label: "Fontes", href: "#fontes" },
          { label: "Resultado", href: "#resultado" },
          { label: "Documentos", href: "#documentos" },
        ]}
      />

      <section id="como-funciona" className="scroll-mt-6 px-2 pt-20 sm:px-4 md:px-8 md:pt-28">
        <h2 className="mb-10 text-[16vw] font-medium leading-[0.85] tracking-[-0.06em] text-creme md:text-[9vw]">
          <WordsPullUp text="Como funciona" />
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {PASSOS.map((p) => (
            <div key={p.n} className="rounded-2xl border border-border bg-card p-6">
              <p className="font-mono text-xs tracking-widest text-creme/45">{p.n}</p>
              <h3 className="mt-3 text-2xl font-medium tracking-tight text-creme">{p.titulo}</h3>
              <p className="mt-2 text-sm leading-relaxed text-creme/60">{p.texto}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-creme/50">
          Um título fica <span className="text-ok">OK</span> quando valor, datas e emissor conferem com os documentos e
          com a WP_Termo; <span className="text-erro">Divergente</span> quando algum campo diverge;{" "}
          <span className="text-aviso">Verificar</span> quando os documentos não concordam entre si ou só há documentos
          do mesmo emissor; e <span className="text-creme/70">Sem documentos</span> quando nada na pasta cita o valor
          nem o emissor.
        </p>
      </section>

      <Conferencia />
    </main>
  );
}
