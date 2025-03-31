// Import necessary modules from Three.js library
import * as THREE from 'three';
// Import OrbitControls for camera manipulation (pan, zoom, rotate)
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration & Constants ---
const STUD_SIZE = 2;
const PLATE_HEIGHT = 2.4;
const BASE_COLOR = 0xffffff;
const GRID_Y_POSITION = 0; // Y-level of the grid plane for placement
const MOVEMENT_INCREMENT = STUD_SIZE; // How much to move per arrow key press
const DEBUG_LOGGING = true; // <<<<<<<<< CONTROL LOGGING HERE

// --- Scene Setup Variables ---
let scene, camera, renderer, controls;
let basePlateMesh = null;
let structureGroup = new THREE.Group(); // Group for the ORIGINAL loaded structure bricks
const container = document.getElementById('container');
const userPlacedGroups = []; // Array to keep track of user-placed structure clones

// --- Data Variables ---
let jsonData = [];
let currentJsonIndex = 0;

// --- Interactivity Variables ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedStructureGroup = null; // Points ONLY to the main `structureGroup` when selected
let activeCloneGroup = null; // The GROUP currently being moved
let isMovingCloneGroup = false;
const originalMaterialsMap = new Map(); // Stores original materials { meshUuid: material }
const highlightMaterial = new THREE.MeshStandardMaterial({
    name: "HighlightMaterial", // Easier debugging
    color: 0x00ffff, // Cyan highlight
    emissive: 0x00aaaa,
    roughness: 0.6,
    metalness: 0.2,
    side: THREE.DoubleSide // Ensure visibility if camera goes inside slightly
});

// Helper function for logging
function logDebug(...args) {
    if (DEBUG_LOGGING) {
        console.log('[DEBUG]', ...args);
    }
}

/**
 * Initializes the Three.js scene, loads data, sets up interactivity listeners.
 */
async function init() {
    logDebug("init() called");
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x445566);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(15, 20, 25);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    // --- Controls ---
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;
    controls.target.set(0, 2, 0);

    // --- Optional Grid Helper ---
    const gridHelper = new THREE.GridHelper(50, 50 / STUD_SIZE, 0x888888, 0x444444);
    gridHelper.position.y = GRID_Y_POSITION;
    scene.add(gridHelper);

    // Add the main structure group to the scene
    scene.add(structureGroup);
    structureGroup.name = "OriginalStructureGroup"; // Name for debugging

    // --- Event Listeners ---
    logDebug("Adding event listeners...");
    window.addEventListener('resize', onWindowResize);
    document.getElementById('cycleBtn').addEventListener('click', cycleStructure);
    renderer.domElement.addEventListener('click', onSelectClick); // Use click for selection
    window.addEventListener('keydown', onKeyDown);
    logDebug("Event listeners added.");

    // --- Load Structure Data ---
    try {
        logDebug("Fetching structures.json...");
        const response = await fetch('structures.json');
        logDebug("Fetch response status:", response.status);
        if (!response.ok) { throw new Error(response.status === 404 ? 'File not found (404)' : `HTTP error! status: ${response.status}`); }
        jsonData = await response.json();
        logDebug("Successfully loaded and parsed structures.json:", jsonData.length, "structures found.");
        if (jsonData && Array.isArray(jsonData) && jsonData.length > 0) {
            buildStructure(jsonData[currentJsonIndex].data); // Build initial structure
            updateStructureInfo();
        } else { console.warn("No structures found..."); updateStructureInfo("No structures found."); document.getElementById('cycleBtn').disabled = true; }
    } catch (error) { console.error("Failed to load structures:", error); updateStructureInfo(`FATAL: ${error.message}`); document.getElementById('cycleBtn').disabled = true; return; }

    animate();
    logDebug("init() finished");
}

/** Handles window resize. */
function onWindowResize() { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }

/** Updates mouse coords for raycasting. */
function updateMouseCoordinates(event) { const rect = renderer.domElement.getBoundingClientRect(); mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; }


/** Resets any highlighting on the original structure group */
function clearHighlight() {
    logDebug("clearHighlight() called. Current selection:", selectedStructureGroup ? selectedStructureGroup.name : 'None', "Map size:", originalMaterialsMap.size);
    if (originalMaterialsMap.size > 0) {
        originalMaterialsMap.forEach((originalMaterial, uuid) => {
            // Primarily check the main structure group
            const mesh = structureGroup.getObjectByProperty('uuid', uuid);
            if (mesh && mesh.isMesh) {
                logDebug(`Restoring material on original mesh ${uuid} from map.`);
                mesh.material = originalMaterial;
            } else {
                 logDebug(`Mesh ${uuid} not found in structureGroup during highlight clear.`);
            }
        });
        originalMaterialsMap.clear();
        logDebug("Highlight map cleared.");
    } else {
        logDebug("Highlight map already empty.");
    }
     if(selectedStructureGroup) {
        logDebug("Setting selectedStructureGroup to null.");
        selectedStructureGroup = null; // Ensure selection state is also cleared
     } else {
        logDebug("selectedStructureGroup was already null.");
     }
}

/**
 * Handles left-click events for selecting the original structure group.
 * @param {MouseEvent} event
 */
function onSelectClick(event) {
    logDebug("--- onSelectClick() ---");
    if (isMovingCloneGroup) { logDebug("Click ignored: Moving a clone group."); return; }

    updateMouseCoordinates(event);
    logDebug("Mouse coords (NDC):", mouse.x.toFixed(2), mouse.y.toFixed(2));
    raycaster.setFromCamera(mouse, camera);

    // Check intersection with children of the ORIGINAL structure group ONLY
    logDebug("Raycasting against structureGroup children (count:", structureGroup.children.length + ")");
    const intersects = raycaster.intersectObjects(structureGroup.children, false); // false = non-recursive
    logDebug("Intersection results:", intersects.length, intersects[0] ? `Hit: ${intersects[0].object.uuid} (name: ${intersects[0].object.name})` : 'No hit');

    // Always clear previous highlight before processing new click
    logDebug("Calling clearHighlight() before processing click...");
    clearHighlight();

    if (intersects.length > 0) {
        logDebug("Intersection found!");
        // An original brick was clicked, so select the main structure group
        selectedStructureGroup = structureGroup; // Set the selection state
        logDebug("Set selectedStructureGroup =", selectedStructureGroup.name);
        logDebug("Applying highlight...");

        // Apply highlight
        let highlightAppliedCount = 0;
        selectedStructureGroup.children.forEach((child, index) => {
            if (child.isMesh) {
                // Store original material if needed
                if (!originalMaterialsMap.has(child.uuid)) {
                    originalMaterialsMap.set(child.uuid, child.material);
                    // logDebug(`Stored original material for ${child.uuid}`);
                }
                 // Apply highlight only if it's not already applied
                 if(child.material !== highlightMaterial){
                    child.material = highlightMaterial;
                    highlightAppliedCount++;
                    // logDebug(`Applied highlight to ${child.uuid}`);
                 }
            }
        });
        logDebug(`Highlight application loop finished. Applied to ${highlightAppliedCount} meshes. Map size: ${originalMaterialsMap.size}`);
    } else {
        logDebug("Clicked empty space or non-original brick. Selection remains cleared.");
        // Highlight was already cleared by clearHighlight() above
    }
     logDebug("--- onSelectClick() Finished --- Selected:", selectedStructureGroup ? selectedStructureGroup.name : 'None');
}


/**
 * Handles keydown events for cloning ('c'), moving (arrows), and placing ('c').
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
    logDebug(`--- onKeyDown(): key='${event.key}' ---`);

    // --- 'C' Key Logic (Clone or Place) ---
    if (event.key.toLowerCase() === 'c') {
        logDebug(`'C' pressed. State: isMovingCloneGroup=${isMovingCloneGroup}, selectedStructureGroup=${selectedStructureGroup ? selectedStructureGroup.name : 'null'}`);

        if (isMovingCloneGroup) {
            // --- Place the active clone group ---
            logDebug("Attempting to PLACE clone group...");
            if (activeCloneGroup) {
                logDebug("Active clone group found. Placing at:", activeCloneGroup.position);
                isMovingCloneGroup = false;
                controls.enabled = true;

                // Restore appearance by making materials opaque
                let restoredCount = 0;
                activeCloneGroup.children.forEach(child => {
                    if (child.isMesh && child.material.transparent) { // Only touch transparent ones
                        child.material.transparent = false;
                        child.material.opacity = 1.0;
                        restoredCount++;
                        // Optional: Reset color/emissive if they were changed for transparency
                    }
                });
                logDebug(`Restored appearance for ${restoredCount} meshes in clone.`);

                userPlacedGroups.push(activeCloneGroup);
                logDebug("Added placed group to userPlacedGroups. Count:", userPlacedGroups.length);
                activeCloneGroup = null; // Clear active reference
                logDebug("Placement complete. isMovingCloneGroup=false, activeCloneGroup=null.");
            } else {
                 console.warn("State inconsistency: isMovingCloneGroup=true, but no activeCloneGroup found!");
                 isMovingCloneGroup = false; // Reset state
                 controls.enabled = true;
            }
        } else {
            // --- Create a new clone group ---
            logDebug("Attempting to CREATE clone group...");
            // <<<<<<<< CRITICAL CHECK >>>>>>>>
            if (selectedStructureGroup) {
                logDebug("Original structure IS selected. Proceeding with cloning.");
                isMovingCloneGroup = true;
                controls.enabled = false;
                logDebug("Set isMovingCloneGroup=true, controls.enabled=false");

                // IMPORTANT: Clear highlight from the original structure BEFORE cloning
                logDebug("Clearing highlight from original before cloning...");
                clearHighlight(); // This also sets selectedStructureGroup = null

                logDebug("Creating new activeCloneGroup...");
                activeCloneGroup = new THREE.Group();
                activeCloneGroup.name = `CloneGroup_${Date.now()}`;

                // Clone children and materials individually
                let childrenCloned = 0;
                structureGroup.children.forEach((originalChild) => {
                     if (originalChild.isMesh) {
                         const clonedChild = originalChild.clone(false); // Clone mesh data
                         clonedChild.material = originalChild.material.clone(); // CLONE the material
                         clonedChild.material.transparent = true; // Make the CLONED material transparent
                         clonedChild.material.opacity = 0.6;
                         activeCloneGroup.add(clonedChild);
                         childrenCloned++;
                     }
                 });
                 logDebug(`Finished cloning children. ${childrenCloned} meshes cloned into new group.`);


                // Set initial position (snapped)
                const initialPos = new THREE.Vector3(0, GRID_Y_POSITION + PLATE_HEIGHT / 2, 0);
                snapToGridGroup(initialPos);
                activeCloneGroup.position.copy(initialPos);
                logDebug("Set initial clone group position:", initialPos);

                // Add the fully prepared clone group to the scene
                scene.add(activeCloneGroup);
                logDebug("Added activeCloneGroup to scene:", activeCloneGroup.name);

            } else {
                logDebug("'C' pressed to clone, but selectedStructureGroup is NULL.");
            }
        }
    }

    // --- Arrow Key Logic (Move Active Clone Group) ---
    else if (isMovingCloneGroup && activeCloneGroup) {
        logDebug(`Arrow key pressed: '${event.key}'. Moving clone group.`);
        let moved = false;
        switch (event.key) {
            case 'ArrowUp': activeCloneGroup.position.z -= MOVEMENT_INCREMENT; moved = true; break;
            case 'ArrowDown': activeCloneGroup.position.z += MOVEMENT_INCREMENT; moved = true; break;
            case 'ArrowLeft': activeCloneGroup.position.x -= MOVEMENT_INCREMENT; moved = true; break;
            case 'ArrowRight': activeCloneGroup.position.x += MOVEMENT_INCREMENT; moved = true; break;
        }
        if (moved) {
            snapToGridGroup(activeCloneGroup.position); // Ensure Y stays correct and X/Z snapped
            logDebug("Moved clone group to:", activeCloneGroup.position);
            event.preventDefault(); // Prevent browser page scrolling
        }
    }

    // --- Escape Key Logic (Cancel Move or Clear Selection) ---
    else if (event.key === 'Escape') {
        logDebug("Escape key pressed.");
        if (isMovingCloneGroup && activeCloneGroup) {
            logDebug("Canceling placement of active clone group...");
            scene.remove(activeCloneGroup);
            // Dispose resources
             activeCloneGroup.traverse(child => {
                 if (child.isMesh) {
                     if (child.geometry) child.geometry.dispose();
                     if (child.material && typeof child.material.dispose === 'function') {
                         child.material.dispose(); // Materials were cloned
                     }
                 }
             });

             activeCloneGroup = null;
             isMovingCloneGroup = false;
             controls.enabled = true;
             logDebug("Placement cancelled. isMovingCloneGroup=false, activeCloneGroup=null.");
        } else if (selectedStructureGroup) {
            logDebug("Clearing current selection via Escape...");
            clearHighlight(); // Clear highlight and selection state
        } else {
             logDebug("Escape pressed, but nothing to cancel or clear.");
        }
    }
     logDebug("--- onKeyDown() Finished ---");
}

/** Snaps a group's position Vector3 to the grid. */
function snapToGridGroup(position) { position.x = Math.round(position.x / STUD_SIZE) * STUD_SIZE; position.z = Math.round(position.z / STUD_SIZE) * STUD_SIZE; position.y = GRID_Y_POSITION + PLATE_HEIGHT / 2; }

/** The main animation loop. */
function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }

// --- Brick Logic ---
// CORRECTED HoleOffsets for 2x1 based on description
const BRICK_DEFINITIONS = {
    "base": {
        Size: new THREE.Vector3(4 * STUD_SIZE, PLATE_HEIGHT, 4 * STUD_SIZE),
        HoleOffsets: function(holeId) {
            const col = holeId % 4; const row = Math.floor(holeId / 4);
            const xOffset = (col - 1.5) * STUD_SIZE; const zOffset = (row - 1.5) * STUD_SIZE;
            const yOffset = PLATE_HEIGHT / 2; return new THREE.Vector3(xOffset, yOffset, zOffset);
        }, IsBase: true
    },
    "3x1": {
        Size: new THREE.Vector3(3 * STUD_SIZE, PLATE_HEIGHT, 1 * STUD_SIZE),
        HoleOffsets: function(holeId) {
            const yOffset = (holeId <= 2) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2); // Top 0,1,2; Bottom 3,4,5
            let xOffset = 0;
            if (holeId === 0 || holeId === 3) xOffset = -1 * STUD_SIZE; // Left hole
            if (holeId === 2 || holeId === 5) xOffset = 1 * STUD_SIZE;  // Right hole
            const zOffset = 0;
            return new THREE.Vector3(xOffset, yOffset, zOffset);
        }, TopHoleIds: [0, 1, 2], BottomHoleIds: [3, 4, 5]
    },
    "2x1": {
        Size: new THREE.Vector3(2 * STUD_SIZE, PLATE_HEIGHT, 1 * STUD_SIZE),
        HoleOffsets: function(holeId) {
            const yOffset = (holeId <= 1) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2); // Top 0,1; Bottom 2,3
            let xOffset = 0;
            if (holeId === 0 || holeId === 2) xOffset = -0.5 * STUD_SIZE; // Hole 0 (top left), Hole 2 (bottom left)
            if (holeId === 1 || holeId === 3) xOffset = 0.5 * STUD_SIZE;  // Hole 1 (top right), Hole 3 (bottom right)
            const zOffset = 0;
            return new THREE.Vector3(xOffset, yOffset, zOffset);
        }, TopHoleIds: [0, 1], BottomHoleIds: [2, 3]
    },
    "1x1": {
        Size: new THREE.Vector3(1 * STUD_SIZE, PLATE_HEIGHT, 1 * STUD_SIZE),
        HoleOffsets: function(holeId) {
            const yOffset = (holeId === 0) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2); // Top 0; Bottom 1
            const xOffset = 0; const zOffset = 0;
            return new THREE.Vector3(xOffset, yOffset, zOffset);
        }, TopHoleIds: [0], BottomHoleIds: [1]
    }
};
const COLOR_MAP = { "white":0xffffff,"yellow":0xffff00,"blue":0x0000ff,"orange":0xffa500,"pink":0xffc0cb,"purple":0x800080,"green":0x00ff00,"default":0x888888};
function getBrickDefinition(brickType){return BRICK_DEFINITIONS[brickType];}
function getBrickColorHex(colorName){return COLOR_MAP[colorName?.toLowerCase()]||COLOR_MAP["default"];}
function isTopHole(brickDef,holeId){if(!brickDef)return false;if(brickDef.IsBase)return true;if(!brickDef.TopHoleIds)return false;return brickDef.TopHoleIds.includes(holeId);}

// --- Build Logic ---
/** Clears scene objects and resets state. */
function clearStructure() {
    logDebug("--- clearStructure() ---");
    // Clear highlight/selection state FIRST
    clearHighlight(); // Ensures materials restored, selection cleared

    // Clear original structure group children
    logDebug("Clearing original structureGroup children...");
    while (structureGroup.children.length > 0) {
        const child = structureGroup.children[0];
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material && child.material !== highlightMaterial && typeof child.material.dispose === 'function') {
                 child.material.dispose();
            }
        }
        structureGroup.remove(child);
    }
    logDebug("Original structureGroup cleared.");

    // Clear base plate
    if (basePlateMesh) { logDebug("Clearing base plate..."); scene.remove(basePlateMesh); if(basePlateMesh.geometry) basePlateMesh.geometry.dispose(); if(basePlateMesh.material) basePlateMesh.material.dispose(); basePlateMesh = null; }

    // Clear user-placed groups
    logDebug("Clearing user placed groups (Count:", userPlacedGroups.length + ")");
    userPlacedGroups.forEach(group => {
        scene.remove(group);
        group.traverse(child => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                 if (child.material && typeof child.material.dispose === 'function') {
                     child.material.dispose(); // Cloned materials are safe to dispose
                 }
            }
        });
    });
    userPlacedGroups.length = 0; // Clear the array
    logDebug("User placed groups cleared.");

    // Reset interaction state fully
    if (activeCloneGroup) { // If clearing while moving, remove active clone group too
        logDebug("Clearing active clone group during clearStructure...");
        scene.remove(activeCloneGroup);
        activeCloneGroup.traverse(child => { /* dispose */ if(child.isMesh){ if(child.geometry)child.geometry.dispose(); if(child.material && typeof child.material.dispose === 'function')child.material.dispose();} });
        activeCloneGroup = null;
    }
    isMovingCloneGroup = false;
    controls.enabled = true; // Ensure controls are enabled
    logDebug("Interaction state reset.");
    logDebug("--- clearStructure() Finished ---");
}

/** Builds the structure from data. */
function buildStructure(structureData) {
    logDebug("--- buildStructure() ---");
    // Ensure state is clear before building (clearStructure is called by cycleStructure)
    // This redundancy ensures buildStructure can be called safely independently if needed.
    if(selectedStructureGroup || isMovingCloneGroup || activeCloneGroup) {
        logDebug("buildStructure called with potentially active interaction state, calling clearStructure...");
        clearStructure(); // Make sure everything is clean before build
    }

    const decodedData = structureData;
    if (!Array.isArray(decodedData)) { console.error("Structure data not array:", decodedData); updateStructureInfo("Invalid Data Format"); return; }

    const bricksById = {}; decodedData.forEach(d => { if (d?.id !== undefined) bricksById[String(d.id)] = d; });
    const threeMeshes = {}; const processedBrickIds = {}; const queue = [];
    const baseData = bricksById["1"];
    if (!baseData || baseData.type !== "base") { console.error("Base brick missing/invalid."); updateStructureInfo("Missing Base"); return; }
    const baseDef = getBrickDefinition(baseData.type);
    if (!baseDef) { console.error("Invalid base type def:", baseData.type); updateStructureInfo("Invalid Base Type"); return; }

    // Build Base Plate
    const baseGeometry = new THREE.BoxGeometry(baseDef.Size.x, baseDef.Size.y, baseDef.Size.z);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: getBrickColorHex(baseData.colour), roughness: 0.8, metalness: 0.1 });
    basePlateMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    basePlateMesh.position.set(0, GRID_Y_POSITION, 0);
    scene.add(basePlateMesh);
    threeMeshes[baseData.id] = basePlateMesh; processedBrickIds[baseData.id] = true; queue.push(baseData.id);
    logDebug("Base plate created.");

    // --- Build Loop ---
    logDebug("Starting build loop...");
    while (queue.length > 0) {
        const currentBrickId = queue.shift(); const currentBrickData = bricksById[currentBrickId]; const currentMesh = threeMeshes[currentBrickId];
        if (!currentBrickData || !currentMesh) continue;
        const currentBrickDef = getBrickDefinition(currentBrickData.type);
        if (!currentBrickDef || !Array.isArray(currentBrickData.holes)) continue;
        currentBrickData.holes.forEach(holeData => {
            if (!holeData || holeData.brick === undefined || holeData.id === undefined) return;
            const connectedBrickIdStr = String(holeData.brick);
            if (connectedBrickIdStr !== "-1" && isTopHole(currentBrickDef, holeData.id)) {
                if (!processedBrickIds[connectedBrickIdStr]) {
                    const connectedBrickData = bricksById[connectedBrickIdStr];
                    if (connectedBrickData) {
                        const connectedBrickDef = getBrickDefinition(connectedBrickData.type);
                        if (connectedBrickDef) {
                            if (holeData.connectedToHole === undefined) return;
                            const bottomHoleLocalOffset = currentBrickDef.HoleOffsets(holeData.id);
                            const topHoleLocalOffset = connectedBrickDef.HoleOffsets(holeData.connectedToHole);
                            if (!(bottomHoleLocalOffset instanceof THREE.Vector3) || !(topHoleLocalOffset instanceof THREE.Vector3)) return;
                            const bottomHoleWorldPos = currentMesh.localToWorld(bottomHoleLocalOffset.clone());
                            const parentQuaternion = new THREE.Quaternion(); currentMesh.getWorldQuaternion(parentQuaternion);
                            const relativeRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.degToRad(holeData.orientation || 0));
                            const worldRotation = parentQuaternion.multiply(relativeRotation);
                            const centerOffset = topHoleLocalOffset.clone().applyQuaternion(worldRotation);
                            const newBrickPosition = bottomHoleWorldPos.clone().sub(centerOffset);
                            const newGeometry = new THREE.BoxGeometry(connectedBrickDef.Size.x, connectedBrickDef.Size.y, connectedBrickDef.Size.z);
                            const newMaterial = new THREE.MeshStandardMaterial({ name:`Mat_${connectedBrickData.id}`, color: getBrickColorHex(connectedBrickData.colour), roughness: 0.8, metalness: 0.1 });
                            const newMesh = new THREE.Mesh(newGeometry, newMaterial);
                            newMesh.name = `Brick_${connectedBrickData.id}`; // Give mesh a name
                            newMesh.position.copy(newBrickPosition); newMesh.quaternion.copy(worldRotation);
                            structureGroup.add(newMesh); // Add to the main structure group
                            threeMeshes[connectedBrickIdStr] = newMesh; processedBrickIds[connectedBrickIdStr] = true; queue.push(connectedBrickIdStr);
                        } else { console.warn("Invalid type def:", connectedBrickData.type); }
                    } else { console.warn("Data not found for ID:", connectedBrickIdStr); processedBrickIds[connectedBrickIdStr] = true; }
                }
            }
        });
    }
    logDebug("Build loop finished. Original parts in structureGroup:", structureGroup.children.length);
    logDebug("--- buildStructure() Finished ---");
}


// --- Structure Cycling & Info Update --- (Added clearStructure call)
function cycleStructure() {
    logDebug("--- cycleStructure() ---");
    if(!jsonData || !Array.isArray(jsonData) || jsonData.length === 0){ logDebug("Cannot cycle, no JSON data."); return;}
    currentJsonIndex = (currentJsonIndex + 1) % jsonData.length;
    if(!jsonData[currentJsonIndex] || !Array.isArray(jsonData[currentJsonIndex].data)){ console.error(`Data invalid at index ${currentJsonIndex}`); updateStructureInfo(`Error loading ${currentJsonIndex+1}`); return;}
    logDebug(`Cycling to ${currentJsonIndex+1}/${jsonData.length}: ${jsonData[currentJsonIndex].name||'Unnamed'}`);
    clearStructure(); // <<< Explicitly clear everything before building next <<<
    buildStructure(jsonData[currentJsonIndex].data);
    updateStructureInfo();
    logDebug("--- cycleStructure() Finished ---");
}
function updateStructureInfo(errorMsg = null) { const infoSpan=document.getElementById('structureInfo');if(!infoSpan)return; if(errorMsg){infoSpan.textContent=`Error: ${errorMsg}`;infoSpan.style.color='red';}else if(jsonData&&Array.isArray(jsonData)&&jsonData.length>0&&jsonData[currentJsonIndex]){const n=jsonData[currentJsonIndex].name||`Structure ${currentJsonIndex+1}`;infoSpan.textContent=`Displaying: ${n} (${currentJsonIndex+1}/${jsonData.length})`;infoSpan.style.color='white';}else{infoSpan.textContent="Loading...";infoSpan.style.color='yellow';}}

// --- Start Application ---
init();