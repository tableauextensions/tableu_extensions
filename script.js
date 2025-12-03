// script.js - VERSIÓN FINAL CON DETECCIÓN AUTOMÁTICA Y ALTERNANCIA DE FILTROS

let dashboard = null;
let currentWorksheet = null;
const WORKSHEET_NAME = "Responsable"; 
let finalDimName = "";   
let finalMeasureName = ""; 
// 🎯 NUEVA VARIABLE GLOBAL para rastrear el valor filtrado actualmente
let currentFilterValue = null; 

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

// Carga datos y renderiza
async function loadDataAndRender() {
    if (!currentWorksheet) return;

    try {
        const summary = await currentWorksheet.getSummaryDataAsync({
            maxRows: 1000,
            ignoreSelection: false // Mantiene esta opción para respetar selecciones/filtros de la hoja
        });
        
        const cols = summary.columns;
        const dataTable = summary.data;
        
        // Detección automática: buscamos el primer string (dimensión) y el primer número (medida)
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

        // Se elimina la alerta de diagnóstico para la versión final de usuario
        console.log(`✅ Campos detectados: Dimensión="${finalDimName}", Medida="${finalMeasureName}"`);

        // Procesamiento de datos (D3)
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
        const topData = grouped.slice(0, 15);

        // Renderizado
        renderAnimatedBars(topData, finalDimName, finalMeasureName, currentWorksheet); 
        
        // 🎯 Configurar el listener de filtro después de la carga inicial
        setupFilterListener();

    } catch (err) {
        let errorMsg = err.message || "Error desconocido al solicitar datos.";
        console.error("❌ ERROR CRÍTICO FINAL (API de Tableau):", err);
        document.getElementById("chart").innerHTML = 
            `<p style="color:red; text-align:center;">🔴 Error: ${errorMsg}.</p>`;
    }
}

// 🎯 NUEVA FUNCIÓN: Se suscribe a los cambios de filtro
function setupFilterListener() {
    // Solo suscribimos una vez
    if (currentWorksheet.hasListener(tableau.TableauEventType.FilterChanged)) {
        return;
    }
    
    currentWorksheet.addEventListener(
        tableau.TableauEventType.FilterChanged, 
        (filterEvent) => {
            console.log(`🔄 Evento de filtro en ${filterEvent.fieldName} detectado. Recargando gráfico...`);
            // Llama a la función principal de carga para obtener los datos filtrados y redibujar
            loadDataAndRender();
        }
    );
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
        
        // Efecto visual: Resalta la barra seleccionada
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
        
        // Efecto visual: Restaura la opacidad de todas las barras
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
    const height = container.clientHeight || 400;
    const margin = { top: 20, right: 40, bottom: 40, left: 120 };

    const svg = d3.select(container)
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // --- 1. Escalas (D3) ---
    const x = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.value) * 1.05 || 1])
        .range([0, innerWidth]);

    const y = d3.scaleBand()
        .domain(data.map(d => d.category))
        .range([0, innerHeight])
        .padding(0.2);

    // --- 2. Ejes (D3) ---
    g.append("g")
        .attr("class", "axis axis-y")
        .call(d3.axisLeft(y).tickSizeOuter(0));

    g.append("g")
        .attr("class", "axis axis-x")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).ticks(5));

    // --- 3. Barras (D3) y Click para Alternar Filtro ---
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
            
            // Lógica de alternancia (TOGGLE)
            if (currentFilterValue === categoryValue) {
                clearTableauFilter(worksheetToFilter, dimLabel);
            } else {
                applyTableauFilter(worksheetToFilter, dimLabel, categoryValue);
            }
        });

    // --- 4. Animación de Barras (Anime.js) ---
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

    // --- 5. Etiquetas (D3 y Anime.js) ---
    g.selectAll(".bar-label")
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

    // Animación de Posición de Etiquetas
    anime({
        targets: g.selectAll(".bar-label").nodes(),
        translateX: el => {
            const d = d3.select(el).datum();
            return x(d.value) + 5; 
        },
        easing: 'easeInOutQuad',
        delay: (el, i) => i * 100 + 300, 
        duration: 800
    });
}
