import {
  Eye, TrendingDown, Layers, ShieldCheck, Lock, FlaskConical, RotateCcw, Ghost,
  ArrowDown, ArrowUp, Wallet, Database, AlertTriangle, BookOpen,
} from "lucide-react";
import {
  MODE_LABELS, MODE_DESCRIPTIONS, MODE_RISK, MODE_ORDERS, MODE_DATA,
} from "./amaLabels";

const COMPARATOR_DATA: Record<string, { data: string; engine: string; db: string; orders: string; capital: string; purpose: string }> = {
  LAB: { data: "Controlado / histórico", engine: "Sí", db: "Aislado", orders: "Simuladas", capital: "No", purpose: "Probar estrategias y escenarios rápidamente" },
  REPLAY: { data: "Pasado real", engine: "Sí", db: "Aislado", orders: "Simuladas", capital: "No", purpose: "Ver qué habría hecho AMA en otro período" },
  SHADOW_SCENARIO: { data: "Mercado controlado", engine: "Sí", db: "Sí", orders: "Simuladas", capital: "No", purpose: "Probar el sistema completo con mercado sintético" },
  SHADOW_LIVE: { data: "Mercado actual real", engine: "Sí", db: "Sí", orders: "Simuladas", capital: "No", purpose: "Observar decisiones en tiempo real sin riesgo" },
  REAL_LIMITED: { data: "Mercado actual real", engine: "Sí", db: "Sí", orders: "Maker reales (post-only)", capital: "Sí", purpose: "Ejecutar con dinero real dentro de límites estrictos" },
};

const GLOSSARY: { term: string; def: string }[] = [
  { term: "HWM", def: "Máximo de referencia — el precio más alto reciente desde el que AMA mide la caída." },
  { term: "Caída", def: "Porcentaje que BTC ha bajado desde el HWM. Cuanto mayor, mayor oportunidad." },
  { term: "Zona macro", def: "Clasificación del mercado según la caída: normal, corrección, valor, valor profundo, crisis." },
  { term: "Tramo", def: "Cada una de las entradas en que AMA divide el capital. No invierte todo de golpe." },
  { term: "Mandato", def: "Configuración que define los objetivos y restricciones de AMA." },
  { term: "Política", def: "Resolución del mandato en parámetros concretos: tramos, porcentajes, estilos." },
  { term: "Replay", def: "Reproducción del mercado histórico vela a vela para ver qué habría hecho AMA." },
  { term: "Shadow", def: "Simulación completa: AMA decide y genera órdenes, pero ninguna es real." },
  { term: "Maker", def: "Orden que aporta liquidez al libro de órdenes. Siempre post-only." },
  { term: "Post-only", def: "Orden que nunca cruza con el spread. Si no cabe, se cancela en lugar de ejecutarse como taker." },
  { term: "Reconciliación", def: "Verificación de que el estado interno coincide con la base de datos y el exchange." },
  { term: "Kill switch", def: "Parada de emergencia que detiene todas las operaciones de AMA inmediatamente." },
];

const MODE_ICONS: Record<string, React.ReactNode> = {
  LAB: <FlaskConical className="h-5 w-5 text-purple-400" />,
  REPLAY: <RotateCcw className="h-5 w-5 text-blue-400" />,
  SHADOW_SCENARIO: <Ghost className="h-5 w-5 text-yellow-400" />,
  SHADOW_LIVE: <Eye className="h-5 w-5 text-amber-400" />,
  REAL_LIMITED: <ShieldCheck className="h-5 w-5 text-orange-400" />,
  REAL_FULL: <Lock className="h-5 w-5 text-red-400" />,
};

const FLOW_STEPS = [
  { num: 1, title: "OBSERVA EL MERCADO", desc: "AMA vigila el precio de BTC y calcula el máximo de referencia (HWM)." },
  { num: 2, title: "DETECTA UNA CAÍDA MACRO", desc: "Mide cuánto ha caído BTC desde el HWM y clasifica la zona macro." },
  { num: 3, title: "ENTRA POR TRAMOS", desc: "Divide el capital en entradas escalonadas según la política activa." },
  { num: 4, title: "VIGILA LA RECUPERACIÓN", desc: "Monitoriza el precio y espera señales de recuperación del mercado." },
  { num: 5, title: "VENDE / DISTRIBUYE", desc: "Ejecuta salidas según los objetivos del mandato y protege el capital." },
];

export function AmaHelpTab() {
  return (
    <div className="space-y-8 max-w-[1200px] mx-auto">
      {/* QUÉ HACE AMA */}
      <section>
        <h2 className="text-xl font-bold mb-3">Qué hace AMA</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          AMA — <strong>Acumulación Macro Adaptativa</strong> — está diseñado para aprovechar
          grandes correcciones del mercado, especialmente en BTC.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground mt-2">
          No intenta comprar y vender constantemente. Observa el ciclo macro, identifica
          máximos de referencia, mide cuánto ha caído el mercado y espera zonas de precio
          cada vez más interesantes.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground mt-2">
          Cuando las condiciones son suficientes, reparte el capital en varias entradas
          en lugar de invertirlo todo de golpe.
        </p>
      </section>

      {/* CÓMO TRABAJA */}
      <section>
        <h2 className="text-xl font-bold mb-4">Cómo trabaja</h2>
        <div className="flex flex-col md:flex-row items-stretch gap-2">
          {FLOW_STEPS.map((step, i) => (
            <div key={step.num} className="flex items-center gap-2 md:flex-1">
              <div className="flex-1 rounded-lg border border-border/30 bg-card/30 px-4 py-4 text-center">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm mx-auto mb-2">
                  {step.num}
                </div>
                <div className="text-sm font-semibold mb-1">{step.title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed">{step.desc}</div>
              </div>
              {i < FLOW_STEPS.length - 1 && (
                <ArrowDown className="h-4 w-4 text-muted-foreground/50 rotate-90 md:rotate-0 flex-shrink-0 hidden md:block" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* CUÁNDO COMPRA */}
      <section>
        <h2 className="text-xl font-bold mb-3">Cuándo compra AMA</h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-2">
          AMA no compra simplemente porque BTC caiga un día. Analiza:
        </p>
        <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
          <li>Máximo de referencia (HWM)</li>
          <li>Porcentaje de caída desde el HWM</li>
          <li>Zona macro actual</li>
          <li>Histórico disponible</li>
          <li>Política activa y mandato</li>
          <li>Capital disponible en Cartera Global</li>
          <li>Estado del ciclo</li>
          <li>Protecciones (kill switch, reconciliación)</li>
        </ul>
        <p className="text-sm leading-relaxed text-muted-foreground mt-2">
          Las entradas se realizan por tramos. Cuanto mayor sea la oportunidad según la política,
          puede habilitarse una parte diferente del capital.
        </p>
      </section>

      {/* CÓMO COMPRA */}
      <section>
        <h2 className="text-xl font-bold mb-3">Cómo compra AMA</h2>
        <ul className="text-sm text-muted-foreground space-y-2">
          <li>• El capital se divide en <strong>tramos</strong> que se ejecutan en distintos niveles de caída.</li>
          <li>• Se calcula el <strong>coste medio</strong> de todas las entradas.</li>
          <li>• El capital máximo está gobernado por el mandato y la Cartera Global.</li>
          <li>• Antes de cada orden se verifica la <strong>reserva</strong> disponible.</li>
          <li>• Toda compra se atribuye al modo <strong>AMA</strong> en la Cartera Global.</li>
          <li>• En modo REAL, las órdenes son <strong>maker / post-only</strong>. Nunca market ni taker.</li>
        </ul>
        <div className="mt-3 rounded-md bg-muted/10 border border-border/20 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 inline mr-1 text-amber-400/70" />
          Laboratorio, Histórico y Simulación <strong>no usan dinero real</strong>. Solo Real limitado opera con capital real.
        </div>
      </section>

      {/* CUÁNDO VENDE */}
      <section>
        <h2 className="text-xl font-bold mb-3">Cuándo vende AMA</h2>
        <p className="text-sm leading-relaxed text-muted-foreground mb-2">
          AMA vende cuando se cumplen las condiciones del mandato activo:
        </p>
        <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
          <li>Recuperación del mercado hacia zonas altas</li>
          <li>Objetivos del mandato alcanzados (recuperar capital, reducir riesgo)</li>
          <li>Distribución parcial de beneficios</li>
          <li>Proximidad a zonas pre-caída cuando aplique</li>
          <li>Protección de beneficios realizada</li>
          <li>Trailing / adaptación si forma parte de la política activa</li>
        </ul>
        <p className="text-sm leading-relaxed text-muted-foreground mt-2">
          Las salidas también se dividen en tramos. AMA no vende todo de golpe.
        </p>
      </section>

      {/* PROTECCIONES */}
      <section>
        <h2 className="text-xl font-bold mb-3">Protecciones</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border border-border/20 bg-card/20 px-3 py-2">
            <ShieldCheck className="h-4 w-4 text-green-400 mb-1" />
            <div className="font-medium">Cartera Global</div>
            <div className="text-xs text-muted-foreground">Controla el capital disponible y los límites.</div>
          </div>
          <div className="rounded-md border border-border/20 bg-card/20 px-3 py-2">
            <Wallet className="h-4 w-4 text-cyan-400 mb-1" />
            <div className="font-medium">Límites de capital</div>
            <div className="text-xs text-muted-foreground">Capital máximo, tramo máximo, tramos por ciclo.</div>
          </div>
          <div className="rounded-md border border-border/20 bg-card/20 px-3 py-2">
            <Lock className="h-4 w-4 text-orange-400 mb-1" />
            <div className="font-medium">Maker / Post-only</div>
            <div className="text-xs text-muted-foreground">En REAL, solo órdenes maker. Sin market ni taker.</div>
          </div>
          <div className="rounded-md border border-border/20 bg-card/20 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-red-400 mb-1" />
            <div className="font-medium">Kill switch</div>
            <div className="text-xs text-muted-foreground">Parada de emergencia que detiene todo inmediatamente.</div>
          </div>
          <div className="rounded-md border border-border/20 bg-card/20 px-3 py-2">
            <Database className="h-4 w-4 text-blue-400 mb-1" />
            <div className="font-medium">Reconciliación</div>
            <div className="text-xs text-muted-foreground">Verifica que el estado interno coincide con DB y exchange.</div>
          </div>
          <div className="rounded-md border border-border/20 bg-card/20 px-3 py-2">
            <ShieldCheck className="h-4 w-4 text-amber-400 mb-1" />
            <div className="font-medium">Restart safety</div>
            <div className="text-xs text-muted-foreground">REAL no se reactiva solo tras un reinicio. Requiere acción manual.</div>
          </div>
        </div>
        <div className="mt-3 rounded-md bg-red-500/5 border border-red-500/20 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 inline mr-1 text-red-400" />
          <strong>REAL_FULL</strong> está bloqueado. Reservado para el futuro — sin handler ni endpoint de activación.
        </div>
      </section>

      {/* MODOS */}
      <section>
        <h2 className="text-xl font-bold mb-4">Modos disponibles</h2>
        <div className="space-y-4">
          {Object.entries(COMPARATOR_DATA).map(([mode, info]) => (
            <div key={mode} className="rounded-lg border border-border/30 bg-card/20 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                {MODE_ICONS[mode]}
                <h3 className="text-base font-semibold">{MODE_LABELS[mode]}</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <div><span className="text-muted-foreground">Mercado: </span>{info.data}</div>
                <div><span className="text-muted-foreground">Órdenes: </span>{info.orders}</div>
                <div><span className="text-muted-foreground">Capital real: </span>{info.capital}</div>
                <div><span className="text-muted-foreground">BD real: </span>{info.db}</div>
              </div>
              <div className="text-sm text-muted-foreground mt-2">
                <span className="text-foreground/80">Sirve para: </span>{info.purpose}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* TABLA COMPARATIVA */}
      <section>
        <h2 className="text-xl font-bold mb-3">Comparación de modos</h2>
        <div className="overflow-x-auto rounded-lg border border-border/30">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border/30 bg-muted/10">
                <th className="text-left py-2 px-3">Modo</th>
                <th className="text-center px-3">Mercado</th>
                <th className="text-center px-3">Motor AMA</th>
                <th className="text-center px-3">BD real</th>
                <th className="text-center px-3">Órdenes</th>
                <th className="text-center px-3">Dinero real</th>
                <th className="text-left px-3">Para qué sirve</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(COMPARATOR_DATA).map(([mode, info]) => (
                <tr key={mode} className="border-b border-border/20 hover:bg-muted/5">
                  <td className="py-2 px-3 font-medium">{MODE_LABELS[mode]}</td>
                  <td className="text-center px-3 text-xs">{info.data}</td>
                  <td className="text-center px-3 text-xs">{info.engine}</td>
                  <td className="text-center px-3 text-xs">{info.db}</td>
                  <td className="text-center px-3 text-xs">{info.orders}</td>
                  <td className="text-center px-3 text-xs">{info.capital}</td>
                  <td className="px-3 text-xs text-muted-foreground">{info.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* GLOSARIO */}
      <section>
        <h2 className="text-xl font-bold mb-3 flex items-center gap-2">
          <BookOpen className="h-5 w-5" /> Glosario
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {GLOSSARY.map((g) => (
            <div key={g.term} className="rounded-md border border-border/20 bg-card/20 px-3 py-2">
              <div className="text-sm font-medium">{g.term}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{g.def}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
