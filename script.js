// script.js - ROTACIÓN 3D + DOS HOJAS SIN ESPEJO

let dashboard = null;
let currentWorksheet = null;

// ⭐ CONFIGURACIÓN DE HOJAS
const WORKSPACE_CONFIG = {
    "Responsable": { name: "Responsable", title: "RESPONSABLE" },
    "Area": { name: "Area", title: "POR ÁREA" }
};

let currentWorksheetKey = "Responsable"; // Hoja inicial
let finalDimName = "";
let finalMeasureName = "";
let currentFilterValue = null;

// ⭐ ELEMENTOS DE ROTACIÓN
let chartCardEl = null;
let isFlipped = false; // Estado de la tarjeta
let reloadTimeout = null;
let listenersConfigured = false;


// =================================================================
// 1. INICIALIZACIÓN
// =================================================================

document.addEventListener("DOMContentLoaded", () => {
    chartCardEl = document.getElementById("chart-card");
    
    tableau.extensions.initializeAsync().then(() => {
        console.log("✅ Tableau API inicializada");
        dashboard = tableau.extensions.dashboardContent.dashboard;
        
        const initialConfig = WORKSPACE_CONFIG[currentWorksheetKey];
        const targetWorksheet = dashboard.worksheets.find(
            ws => ws.name === initialConfig.name
        );

        if (targetWorksheet) {
            currentWorksheet = targetWorksheet;
            setupFilterListeners();
            
            animateTitle(initialConfig.title);
            setupCardDrag();
            
            loadDataAndRender(currentWorksheetKey);
        } else {
            console.error(`❌ Hoja "${initialConfig.name}" no encontrada en el dashboard.`);
            const container = getActiveChartContainer();
            if (container) {
                container.innerHTML = 
                    `<p style="color:red; text-align:center;">Error: La hoja <b>"${initialConfig.name}"</b> no fue encontrada.</p>`;
            }
        }
    }, err => {
        console.error("❌ Error al inicializar la extensión:", err);
    });
});


// =================================================================
// 2. LÓGICA DE ROTACIÓN (DRAG-MAPPING SIMULADO)
// =================================================================

function setupCardDrag() {
    if (!chartCardEl) return;
    
    let currentRotationY = 0; 
    
    const dragHandler = d3.drag()
        .on("drag", function(event) {
            // Mapeamos el arrastre horizontal a la rotación
            const rotationStep = event.dx * 0.5; 
            currentRotationY += rotationStep;

            // Aplicamos la rotación 3D usando Anime.js
            anime.set(chartCardEl, {
                rotateY: currentRotationY + 'deg'
            });
            
            chartCardEl.style.cursor = 'grabbing';
        })
        .on("end", function(event) {
            chartCardEl.style.cursor = 'grab';
            
            // 1. Calcular la rotación estable más cercana (múltiplo de 180)
            const nearestStableRotation = Math.round(currentRotationY / 180) * 180;
            const finalRotation = nearestStableRotation;
            
            // 2. Determinar si el estado 'isFlipped' debe cambiar
            const isTargetFlipped = (Math.abs(finalRotation / 180) % 2) === 1;
            if (isFlipped !== isTargetFlipped) {
                isFlipped = isTargetFlipped;
            }

            // 3. Animar a la rotación estable
            anime({
                targets: chartCardEl,
                rotateY: finalRotation + 'deg',
                duration: 500,
                easing: 'easeOutQuad',
                complete: () => {
                    // Sincronizar la rotación con el valor estable
                    currentRotationY = finalRotation; 
                    
                    // 4. Lógica de cambio de hoja y título
                    const newKey = isFlipped ? "Area" : "Responsable";
                    if (currentWorksheetKey !== newKey) {
                        animateTitle(WORKSPACE_CONFIG[newKey].title);
                        loadDataAndRender(newKey);
                    }
                }
            });
        });

    d3.select(chartCardEl).call(dragHandler);
    console.log("✅ Lógica de arrastre de tarjeta configurada.");
}


// =================================================================
// 3. FUNCIONES DE CARGA DE DATOS Y RENDERIZADO
// =================================================================

function getActiveChartContainerId() {
    return currentWorksheetKey === "Responsable"
        ? "chart-responsable"
        : "chart-area";
}

function getActiveChartContainer() {
    const id = getActiveChartContainerId();
    return document.getElementById(id);
}

async function loadDataAndRender(newWorksheetKey) {
    currentWorksheetKey = newWorksheetKey;
    const worksheetName = WORKSPACE_CONFIG[currentWorksheetKey].name;

    const targetWorksheet = dashboard.worksheets.find(
        ws => ws.name === worksheetName 
    );
    
    const containerId = getActiveChartContainerId();
    const container = document.getElementById(containerId);

    if (!targetWorksheet) {
        if (container) {
            container.innerHTML = `<p style="color:red; text-align:center;">Error: La hoja <b>"${worksheetName}"</b> no fue encontrada.</p>`;
        }
        return;
    }
    currentWorksheet = targetWorksheet;

    try {
        const summary = await currentWorksheet.getSummaryDataAsync({
            maxRows: 1000,
            ignoreSelection: false
        });
        
        const cols = summary.columns;
        const dataTable = summary.data;
        
        let dimCol = cols.find(c => c.dataType === "string");
        let measureCol = cols.find(c => 
            c.dataType === "int" || 
            c.dataType === "float" || 
            c.dataType === "number"
        );

        if (!dimCol || !measureCol) {
            if (container) {
                container.innerHTML = 
                    `<p style="color:orange; text-align:center;">⚠️ La hoja no expone una Dimensión (texto) y una Medida (número) adecuadas para graficar.</p>`;
            }
            return;
        }

        const dimIndex = cols.indexOf(dimCol);
        const measureIndex = cols.indexOf(measureCol);
        finalDimName = dimCol.fieldName;
        finalMeasureName = measureCol.fieldName;

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

        renderAnimatedBars(
            displayData,
            finalDimName,
            finalMeasureName,
            currentWorksheet,
            containerId
        ); 
        await syncVisualWithCurrentFilter();

    } catch (err) {
        let errorMsg = err.message || "Error desconocido al solicitar datos.";
        console.error("❌ ERROR CRÍTICO FINAL (API de Tableau):", err);
        if (container) {
            container.innerHTML = 
                `<p style="color:red; text-align:center;">🔴 Error: ${errorMsg}.</p>`;
        }
    }
}


// =================================================================
// 4. FUNCIONES AUXILIARES DE TABLEAU Y D3
// =================================================================

function setupFilterListeners() {
    try {
        if (!dashboard || !dashboard.worksheets || listenersConfigured) return;

        dashboard.worksheets.forEach(ws => {
            ws.addEventListener(
                tableau.TableauEventType.FilterChanged,
                () => {
                    if (reloadTimeout) {
                        clearTimeout(reloadTimeout);
                    }
                    reloadTimeout = setTimeout(() => {
                        loadDataAndRender(currentWorksheetKey);
                    }, 150);
                }
            );
        });

        listenersConfigured = true;
    } catch (e) {
        console.error("❌ Error al configurar listeners de filtros:", e);
    }
}

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

function applyTableauFilter(sourceWorksheet, fieldName, value) {
    sourceWorksheet.applyFilterAsync(
        fieldName, 
        [value],   
        tableau.FilterUpdateType.Replace 
    ).then(() => {
        currentFilterValue = value; 
        d3.selectAll(".bar").style("opacity", 0.4); 
        d3.selectAll(".bar")
            .filter(d => d.category === value)
            .style("opacity", 1.0);
    }).catch(err => {
        console.error("❌ Error al aplicar el filtro:", err);
    });
}

function clearTableauFilter(sourceWorksheet, fieldName) {
    sourceWorksheet.clearFilterAsync(
        fieldName
    ).then(() => {
        currentFilterValue = null;
        d3.selectAll(".bar").style("opacity", 1.0); 
    }).catch(err => {
        console.error("❌ Error al limpiar el filtro:", err);
    });
}


// =================================================================
// 5. RENDERIZADO D3 CON ANIMACIÓN ANIME.JS
// =================================================================

function renderAnimatedBars(
    data,
    dimLabel,
    measureLabel,
    worksheetToFilter,
    containerId
) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error("❌ Contenedor no encontrado:", containerId);
        return;
    }

    container.innerHTML = ""; // Limpia el contenido anterior

    const width = container.clientWidth || 600;
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

    // Ejes
    g.append("g")
        .attr("class", "axis axis-y")
        .call(d3.axisLeft(y).tickSizeOuter(0));

    g.append("g")
        .attr("class", "axis axis-x")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).ticks(5));

    // Barras
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

    // Animación de entrada de barras (Anime.js)
    anime({
        targets: bars.nodes(),
        width: el => x(d3.select(el).datum().value),
        easing: 'easeOutElastic(1, .8)',
        delay: (el, i) => i * 100,
        duration: 1200
    });

    // Etiquetas de valor
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

    // Animación de entrada de etiquetas (Anime.js)
    anime({
        targets: labels.nodes(),
        translateX: el => x(d3.select(el).datum().value) + 5,
        easing: 'easeInOutQuad',
        delay: (el, i) => i * 100 + 300,
        duration: 800
    });
}


// =================================================================
// 6. FUNCIONES DE UTILERÍA (TÍTULO)
// =================================================================

function splitTextIntoSpans(selector) {
    const element = document.querySelector(selector);
    if (!element) return;
    
    const text = element.textContent;
    const splitText = text.split('').map(char => {
        return `<span>${char === ' ' ? '&nbsp;' : char}</span>`;
    }).join('');

    element.innerHTML = splitText;
}

function animateTitle(titleText) {
    const titleEl = document.getElementById('title-container');
    titleEl.textContent = titleText;
    
    anime.set(titleEl, { opacity: 0 }); 

    splitTextIntoSpans('#title-container');

    anime.timeline({ loop: false })
        .add({
            targets: titleEl,
            opacity: [0, 1],
            duration: 100
        }, 0)
        .add({
            targets: '#title-container span',
            opacity: [0, 1],
            scale: [0.3, 1],
            easing: "easeOutExpo",
            duration: 600,
            delay: (el, i) => 70 * (i+1)
        });
}
