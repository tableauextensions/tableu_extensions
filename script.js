// script.js - VERSIÓN FINAL CON DETECCIÓN AUTOMÁTICA, ALTERNANCIA Y ESCUCHA DE FILTROS

let dashboard = null;
let currentWorksheet = null;
const WORKSHEET_NAME = "Responsable"; 
let finalDimName = "";   
let finalMeasureName = ""; 
// 🎯 VARIABLE GLOBAL para rastrear el valor filtrado actualmente
let currentFilterValue = null; 

// ⭐ NUEVO: para no recargar 10 veces seguidas
let reloadTimeout = null;
let listenersConfigured = false;

// Inicialización de la extensión
document.addEventListener("DOMContentLoaded", () => {
    tableau.extensions.initializeAsync().then(() => {
        console.log("✅ Tableau API inicializada");
        dashboard = tableau.extensions.dashboardContent.dashboard;
        
        const targetWorksheet = dashboard.worksheets.find(
            ws => ws.name === WORKSHEET_NAME 
        );
        
        if (targetWorksheet) {
            currentWorksheet = targetWorksheet;
            console.log(`➡️ Hoja "${WORKSHEET_NAME}" encontrada. Cargando datos...`);

            // 🔥 Escuchar filtros (con debounce)
            setupFilterListeners();

            loadDataAndRender(); 
        } else {
            console.error(`❌ Hoja "${WORKSHEET_NAME}" no encontrada en el dashboard.`);
            document.getElementById("chart").innerHTML = 
                `<p style="color:red; text-align:center;">Error: La hoja <b>"${WORKSHEET_NAME}"</b> no fue encontrada.</p>`;
        }
    }, err => {
        console.error("❌ Error al inicializar la extensión:", err);
    });
});


// 🔥 Escucha cambios de filtro en TODAS las hojas del dashboard (pero recarga una sola vez)
function setupFilterListeners() {
    try {
        if (!dashboard || !dashboard.worksheets) {
            console.warn("⚠️ Dashboard aún no está listo para configurar listeners.");
            return;
        }

        // ⭐ Evitar agregar listeners duplicados
        if (listenersConfigured) {
            console.log("ℹ️ Listeners de filtros ya estaban configurados. No se duplican.");
            return;
        }

        dashboard.worksheets.forEach(ws => {
            ws.addEventListener(
                tableau.TableauEventType.FilterChanged,
                () => {
                    console.log(`🔄 Filtro cambiado en hoja "${ws.name}". Programando recarga...`);

                    // ⭐ DEBOUNCE: si llegan muchos eventos seguidos, solo recargamos una vez
                    if (reloadTimeout) {
                        clearTimeout(reloadTimeout);
                    }
                    reloadTimeout = setTimeout(() => {
                        console.log("🔁 Ejecutando recarga de datos y redibujando gráfico una sola vez.");
                        loadDataAndRender();
                    }, 150); // 150 ms suele ser suficiente
                }
            );
        });

        listenersConfigured = true;
        console.log("✅ Listeners de filtros configurados en todas las hojas (con debounce).");
    } catch (e) {
        console.error("❌ Error al configurar listeners de filtros:", e);
    }
}


// Carga datos y renderiza
async function loadDataAndRender() {
    if (!currentWorksheet) return;

    try {
        const summary = await currentWorksheet.getSummaryDataAsync({
            maxRows: 1000,
            ignoreSelection: false   // 👈 respeta los filtros del dashboard
        });
        
        const cols = summary.columns;
        const dataTable = summary.data;
        
        let dimCol = cols.find(c => c.dataType === "string");
        let measureCol = cols.find(c => c.dataType === "int" || c.dataType === "float" || c.dataType === "number");

        if (!dimCol || !measureCol) {
            console.error("No se encontraron una Dimensión (Cadena) y una Medida (Número) adecuadas.");
            document.getElementById("chart").innerHTML = 
                `<p style="color:orange; text-align:center;">⚠️ La hoja no expone una Dimensión (texto) y una Medida (número) adecuadas para graficar.</p>`;
            return;
        }
        
        const dimIndex = cols.indexOf(dimCol);
        const measureIndex = cols.indexOf(measureCol);
        finalDimName = dimCol.fieldName;
        finalMeasureName = measureCol.fieldName;

        console.log(`✅ Campos detectados: Dimensión="${finalDimName}", Medida="${finalMeasureName}"`);

        let rows = dataTable.map(row => ({
            category: row[dimIndex].formattedValue,
            value: Number(row[measureIndex].value)
        }));

        const grouped = d3.rollups(
            rows,
            v => d3.sum(v, d => d.value),
            d => d.category
        ).map(([category, value]) => ({ category, value }));
        
        grouped.sort((a, b) => b.value - a.value);

        const MAX_BARS = 200;
        const displayData = grouped.slice(0, MAX_BARS);

        renderAnimatedBars(displayData, finalDimName, finalMeasureName, currentWorksheet); 

        // Ajustar visual según filtro actual (por si viene de afuera)
        await syncVisualWithCurrentFilter();

    } catch (err) {
        let errorMsg = err.message || "Error desconocido al solicitar datos.";
        console.error("❌ ERROR CRÍTICO FINAL (API de Tableau):", err);
        document.getElementById("chart").innerHTML = 
            `<p style="color:red; text-align:center;">🔴 Error: ${errorMsg}.</p>`;
    }
}


// 🔥 Sincroniza opacidades con el filtro actual de Tableau
async function syncVisualWithCurrentFilter() {
    try {
        const filters = await currentWorksheet.getFiltersAsync();
        const myFilter = filters.find(f => f.fieldName === finalDimName);

        if (myFilter && myFilter.appliedValues.length > 0) {
            currentFilterValue = myFilter.appliedValues[0].value;
            d3.selectAll(".bar").style("opacity", 0.4);
            d3.selectAll(".bar")
                .filter(d => d.category === currentFilterValue)
                .style("opacity", 1.0);
        } else {
            currentFilterValue = null;
            d3.selectAll(".bar").style("opacity", 1.0);
        }
    } catch (e) {
        console.error("❌ Error al sincronizar estado visual del filtro:", e);
    }
}


// Aplica el filtro de Tableau al dashboard
function applyTableauFilter(sourceWorksheet, fieldName, value) {
    sourceWorksheet.applyFilterAsync(
        fieldName, 
        [value],   
        tableau.FilterUpdateType.Replace 
    ).then(() => {
        console.log(`✅ Filtro aplicado a ${fieldName} con valor ${value}.`);
        currentFilterValue = value; 
        
        d3.selectAll(".bar").style("opacity", 0.4); 
        d3.selectAll(".bar").filter(d => d.category === value).style("opacity", 1.0);

    }).catch(err => {
        console.error("❌ Error al aplicar el filtro:", err);
    });
}


// Limpia el filtro
function clearTableauFilter(sourceWorksheet, fieldName) {
    sourceWorksheet.clearFilterAsync(
        fieldName
    ).then(() => {
        console.log(`✅ Filtro limpiado para el campo ${fieldName}.`);
        currentFilterValue = null;
        d3.selectAll(".bar").style("opacity", 1.0); 

    }).catch(err => {
        console.error("❌ Error al limpiar el filtro:", err);
    });
}


// Renderiza el gráfico de barras animado
function renderAnimatedBars(data, dimLabel, measureLabel, worksheetToFilter) {
    const container = document.getElementById("chart");
    container.innerHTML = ""; 

    const width = container.clientWidth || 600;

    // Altura dinámica según cantidad de barras
    const barHeight = 24;                        
    const minInnerHeight = 200;                  
    const innerHeight = Math.max(minInnerHeight, barHeight * data.length);

    const margin = { top: 20, right: 40, bottom: 40, left: 160 };
    const height = innerHeight + margin.top + margin.bottom;

    const svg = d3.select(container)
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .style("background", "transparent");

    const innerWidth = width - margin.left - margin.right;

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.value) * 1.05 || 1])
        .range([0, innerWidth]);

    const y = d3.scaleBand()
        .domain(data.map(d => d.category))
        .range([0, innerHeight])
        .padding(0.2);

    g.append("g")
        .attr("class", "axis axis-y")
        .call(d3.axisLeft(y).tickSizeOuter(0));

    g.append("g")
        .attr("class", "axis axis-x")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).ticks(5));

    const bars = g.selectAll(".bar")
        .data(data, d => d.category)
        .enter()
        .append("rect")
        .attr("class", "bar interactive-bar")
        .attr("x", 0)
        .attr("y", d => y(d.category))
        .attr("height", y.bandwidth())
        .attr("width", 0) 
        .style("fill", "#38bdf8") 
        .on("click", function(event, d) {
            const categoryValue = d.category;
            if (currentFilterValue === categoryValue) {
                clearTableauFilter(worksheetToFilter, dimLabel);
            } else {
                applyTableauFilter(worksheetToFilter, dimLabel, categoryValue);
            }
        });

    anime({
        targets: bars.nodes(), 
        width: el => {
            const d = d3.select(el).datum(); 
            return x(d.value); 
        },
        easing: 'easeOutElastic(1, .8)', 
        delay: (el, i) => i * 100, 
        duration: 1200
    });

    const labels = g.selectAll(".bar-label")
        .data(data, d => d.category)
        .enter()
        .append("text")
        .attr("class", "bar-label")
        .attr("x", 0) 
        .attr("y", d => y(d.category) + y.bandwidth() / 2)
        .attr("dy", "0.35em")
        .attr("text-anchor", "start")
        .style("fill", "#e5e7eb")
        .style("font-size", "10px")
        .text(d => d3.format(",.2s")(d.value));

    anime({
        targets: labels.nodes(),
        translateX: el => {
            const d = d3.select(el).datum();
            return x(d.value) + 5; 
        },
        easing: 'easeInOutQuad',
        delay: (el, i) => i * 100 + 300, 
        duration: 800
    });
}
