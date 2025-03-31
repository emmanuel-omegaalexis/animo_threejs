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

// --- Scene Setup Variables ---
let scene, camera, renderer, controls;
let basePlateMesh = null;
let structureGroup = new THREE.Group(); // Group for the loaded structure bricks
const container = document.getElementById('container');

// --- Data Variables ---
let jsonData = [];
let currentJsonIndex = 0;

// --- Interactivity Variables ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(); // Normalized device coordinates (-1 to +1) for selection click
let selectedOriginal = null; // The original mesh that was clicked
let activeClone = null; // The mesh currently being moved by arrow keys
let isMovingClone = false; // Flag: true if clone exists and is being moved
let originalSelectedMaterial = null; // To restore material of selected original
let originalCloneMaterial = null; // To restore material of placed clone
const highlightMaterial = new THREE.MeshStandardMaterial({ // Material for selected original
    color: 0xffff00, // Bright yellow
    emissive: 0xaaaa00, // Slight glow
    roughness: 0.6,
    metalness: 0.2,
    // wireframe: true // Optional: use wireframe for highlight
});

/**
 * Initializes the Three.js scene, loads data, sets up interactivity listeners.
 */
async function init() {
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
    controls.screenSpacePanning = true; // Allow panning parallel to screen
    controls.target.set(0, 2, 0);

    // --- Optional Grid Helper ---
    const gridHelper = new THREE.GridHelper(50, 50 / STUD_SIZE, 0x888888, 0x444444);
    gridHelper.position.y = GRID_Y_POSITION;
    scene.add(gridHelper);

    // Add the structure group to the scene
    scene.add(structureGroup);

    // --- Event Listeners ---
    window.addEventListener('resize', onWindowResize);
    document.getElementById('cycleBtn').addEventListener('click', cycleStructure);
    // Use 'click' for selection (simpler than pointerdown/up logic here)
    renderer.domElement.addEventListener('click', onSelectClick);
    // Listen for keydown events on the window
    window.addEventListener('keydown', onKeyDown);

    // --- Load Structure Data ---
    try {
        const response = await fetch('structures.json');
        if (!response.ok) {
            const errorText = response.status === 404 ? 'File not found (404)' : `HTTP error! status: ${response.status}`;
            throw new Error(errorText);
        }
        jsonData = await response.json();
        console.log("Successfully loaded and parsed structures.json");

        if (jsonData && Array.isArray(jsonData) && jsonData.length > 0) {
            buildStructure(jsonData[currentJsonIndex].data);
            updateStructureInfo();
        } else {
            console.warn("No structures found in data file or data format invalid.");
            updateStructureInfo("No structures found in data file.");
            document.getElementById('cycleBtn').disabled = true;
        }

    } catch (error) {
        console.error("Failed to load or parse structures.json:", error);
        updateStructureInfo(`FATAL: Could not load structure data (${error.message})`);
        document.getElementById('cycleBtn').disabled = true;
        return;
    }

    animate(); // Start animation loop only after successful setup
}

/**
 * Handles window resize events.
 */
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * Updates mouse coordinates for raycasting based on click event.
 * @param {MouseEvent} event - The mouse click event.
 */
function updateMouseCoordinates(event) {
    // Calculate mouse position in normalized device coordinates (-1 to +1)
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

/**
 * Handles left-click events for selecting an original structure brick.
 * @param {MouseEvent} event
 */
function onSelectClick(event) {
    // Ignore clicks if currently moving a clone
    if (isMovingClone) {
        console.log("Click ignored: Currently moving a clone.");
        return;
    }

    updateMouseCoordinates(event);
    raycaster.setFromCamera(mouse, camera);

    // IMPORTANT: Only check for intersections with the ORIGINAL structure bricks
    const intersects = raycaster.intersectObjects(structureGroup.children);

    // Restore previously selected brick's material (if any)
    if (selectedOriginal && originalSelectedMaterial) {
        selectedOriginal.material = originalSelectedMaterial;
        originalSelectedMaterial = null; // Clear reference
    }
    selectedOriginal = null; // Clear selection by default

    if (intersects.length > 0) {
        const intersectedObject = intersects[0].object;

        // Ensure it's a mesh within the original structure group
        if (intersectedObject.isMesh && structureGroup.children.includes(intersectedObject)) {
            selectedOriginal = intersectedObject;

            // Store original material and apply highlight
            if (selectedOriginal.material) {
                 // Ensure we don't try to highlight the highlight material itself
                if (selectedOriginal.material !== highlightMaterial) {
                    originalSelectedMaterial = selectedOriginal.material;
                    selectedOriginal.material = highlightMaterial;
                }
            }
            console.log("Selected original brick:", selectedOriginal.uuid);
        }
    } else {
        console.log("Clicked empty space or non-original brick. Selection cleared.");
    }
}


/**
 * Handles keydown events for cloning ('c'), moving (arrows), and placing ('c').
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
    // --- 'C' Key Logic (Clone or Place) ---
    if (event.key.toLowerCase() === 'c') {
        if (isMovingClone) {
            // --- Place the active clone ---
            if (activeClone) {
                console.log("Placing clone at:", activeClone.position);
                isMovingClone = false;
                controls.enabled = true; // Re-enable camera controls

                // Restore original appearance
                if (originalCloneMaterial) {
                    // Check if material is disposable (might be shared if not cloned properly)
                     if (activeClone.material !== originalCloneMaterial && typeof activeClone.material.dispose === 'function') {
                         activeClone.material.dispose();
                     }
                    activeClone.material = originalCloneMaterial;
                }
                activeClone.material.transparent = false; // Ensure it's not transparent
                activeClone.material.opacity = 1.0;

                // The clone remains in the scene where it is.
                activeClone = null; // We are no longer actively manipulating this clone
                originalCloneMaterial = null;

                // Optionally clear the original selection after placement
                // if (selectedOriginal && originalSelectedMaterial) {
                //     selectedOriginal.material = originalSelectedMaterial;
                // }
                // selectedOriginal = null;
                // originalSelectedMaterial = null;
            }
        } else {
            // --- Create a new clone ---
            if (selectedOriginal) {
                console.log("Cloning selected brick:", selectedOriginal.uuid);
                isMovingClone = true;
                controls.enabled = false; // Disable camera controls

                activeClone = selectedOriginal.clone();

                // Store original material for restoration after placement
                // Clone the material itself for transparency changes
                if (activeClone.material) {
                    originalCloneMaterial = activeClone.material; // Store reference to original
                    activeClone.material = activeClone.material.clone(); // Work on a clone
                    activeClone.material.transparent = true;
                    activeClone.material.opacity = 0.6;
                }

                // Initial position: Snap the original's position to grid level
                const initialPos = selectedOriginal.position.clone();
                snapToGrid(initialPos); // Place it on the grid Y level
                activeClone.position.copy(initialPos);

                 // Keep original rotation or reset? Resetting is simpler for grid movement.
                activeClone.rotation.set(0,0,0);
                // activeClone.quaternion.copy(selectedOriginal.quaternion); // To keep rotation

                scene.add(activeClone);

                // Restore selected original's appearance now that clone is active
                if (originalSelectedMaterial) {
                    selectedOriginal.material = originalSelectedMaterial;
                    // Keep originalSelectedMaterial ref in case user cancels
                }
            } else {
                console.log("'C' pressed, but no brick selected.");
            }
        }
    }

    // --- Arrow Key Logic (Move Active Clone) ---
    else if (isMovingClone && activeClone) {
        let moved = false;
        switch (event.key) {
            case 'ArrowUp':
                activeClone.position.z -= MOVEMENT_INCREMENT;
                moved = true;
                break;
            case 'ArrowDown':
                activeClone.position.z += MOVEMENT_INCREMENT;
                moved = true;
                break;
            case 'ArrowLeft':
                activeClone.position.x -= MOVEMENT_INCREMENT;
                moved = true;
                break;
            case 'ArrowRight':
                activeClone.position.x += MOVEMENT_INCREMENT;
                moved = true;
                break;
        }
        if (moved) {
            // Ensure Y position remains correct after movement
            snapToGrid(activeClone.position);
            event.preventDefault(); // Prevent browser scrolling
            console.log("Moved clone to:", activeClone.position);
        }
    }

    // --- Escape Key Logic (Cancel Move) ---
    else if (event.key === 'Escape') {
        if (isMovingClone && activeClone) {
             console.log("Canceling placement.");
             // Remove the clone from the scene and dispose
             if (activeClone.material && activeClone.material !== originalCloneMaterial && typeof activeClone.material.dispose === 'function') {
                activeClone.material.dispose();
             }
              if (activeClone.geometry && typeof activeClone.geometry.dispose === 'function') {
                activeClone.geometry.dispose();
             }
             scene.remove(activeClone);

             // Restore selected original's material if it was highlighted
             if (selectedOriginal && originalSelectedMaterial) {
                 selectedOriginal.material = originalSelectedMaterial;
             }

             // Reset state
             activeClone = null;
             isMovingClone = false;
             originalCloneMaterial = null;
             // Keep selectedOriginal and originalSelectedMaterial until next click
             controls.enabled = true; // Re-enable controls
        }
    }
}


/**
 * Snaps a Vector3 position to the nearest grid point based on STUD_SIZE.
 * Also sets the Y position based on PLATE_HEIGHT and GRID_Y_POSITION.
 * @param {THREE.Vector3} position - The position vector to modify.
 */
function snapToGrid(position) {
    position.x = Math.round(position.x / STUD_SIZE) * STUD_SIZE;
    position.z = Math.round(position.z / STUD_SIZE) * STUD_SIZE;
    position.y = GRID_Y_POSITION + PLATE_HEIGHT / 2; // Center the brick vertically on the grid line
}


/**
 * The main animation loop.
 */
function animate() {
    requestAnimationFrame(animate);
    controls.update(); // Required if damping is enabled
    renderer.render(scene, camera);
}

// --- Brick Logic --- (getBrickDefinition, getBrickColorHex, isTopHole - unchanged)
const BRICK_DEFINITIONS = {
    "base": { Size: new THREE.Vector3(4 * STUD_SIZE, PLATE_HEIGHT, 4 * STUD_SIZE), HoleOffsets: function(holeId) { const col = holeId % 4; const row = Math.floor(holeId / 4); const xOffset = (col - 1.5) * STUD_SIZE; const zOffset = (row - 1.5) * STUD_SIZE; const yOffset = PLATE_HEIGHT / 2; return new THREE.Vector3(xOffset, yOffset, zOffset); }, IsBase: true },
    "3x1": { Size: new THREE.Vector3(3 * STUD_SIZE, PLATE_HEIGHT, 1 * STUD_SIZE), HoleOffsets: function(holeId) { const yOffset = (holeId <= 2) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2); let xOffset = 0; if (holeId === 0 || holeId === 3) xOffset = -1 * STUD_SIZE; if (holeId === 2 || holeId === 5) xOffset = 1 * STUD_SIZE; const zOffset = 0; return new THREE.Vector3(xOffset, yOffset, zOffset); }, TopHoleIds: [0, 1, 2], BottomHoleIds: [3, 4, 5] },
    "2x1": { Size: new THREE.Vector3(2 * STUD_SIZE, PLATE_HEIGHT, 1 * STUD_SIZE), HoleOffsets: function(holeId) { const yOffset = (holeId <= 1) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2); const xOffset = (holeId === 0 || holeId === 2) ? (-0.5 * STUD_SIZE) : (0.5 * STUD_SIZE); const zOffset = 0; return new THREE.Vector3(xOffset, yOffset, zOffset); }, TopHoleIds: [0, 1], BottomHoleIds: [2, 3] },
    "1x1": { Size: new THREE.Vector3(1 * STUD_SIZE, PLATE_HEIGHT, 1 * STUD_SIZE), HoleOffsets: function(holeId) { const yOffset = (holeId === 0) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2); const xOffset = 0; const zOffset = 0; return new THREE.Vector3(xOffset, yOffset, zOffset); }, TopHoleIds: [0], BottomHoleIds: [1] }
};
const COLOR_MAP = { "white": 0xffffff, "yellow": 0xffff00, "blue": 0x0000ff, "orange": 0xffa500, "pink": 0xffc0cb, "purple": 0x800080, "green": 0x00ff00, "default": 0x888888 };
function getBrickDefinition(brickType) { return BRICK_DEFINITIONS[brickType]; }
function getBrickColorHex(colorName) { return COLOR_MAP[colorName?.toLowerCase()] || COLOR_MAP["default"]; }
function isTopHole(brickDef, holeId) { if (!brickDef) return false; if (brickDef.IsBase) return true; if (!brickDef.TopHoleIds) return false; return brickDef.TopHoleIds.includes(holeId); }

// --- Build Logic --- (clearStructure, buildStructure - largely unchanged, uses structureData array)
function clearStructure() {
    // Clear original loaded structure
    while (structureGroup.children.length > 0) {
        const child = structureGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        // Only dispose material if it's not the shared highlightMaterial
        if (child.material && child.material !== highlightMaterial && typeof child.material.dispose === 'function') {
             child.material.dispose();
        }
        structureGroup.remove(child);
    }
    // Clear base plate
    if (basePlateMesh) {
        scene.remove(basePlateMesh);
        if (basePlateMesh.geometry) basePlateMesh.geometry.dispose();
        if (basePlateMesh.material) basePlateMesh.material.dispose();
        basePlateMesh = null;
    }
    // Clear user-placed bricks (added directly to scene)
    const userBricks = scene.children.filter(child =>
        child.isMesh &&
        child !== basePlateMesh &&
        !structureGroup.children.includes(child) &&
        child !== activeClone // Don't remove the currently moving clone
    );
    userBricks.forEach(brick => {
         if (brick.geometry && typeof brick.geometry.dispose === 'function') brick.geometry.dispose();
         // Make sure we don't dispose a material that might be an original reference
         // It's safer to assume materials might be shared if not explicitly cloned everywhere
         // if (brick.material && typeof brick.material.dispose === 'function') brick.material.dispose();
         scene.remove(brick);
    });

     // Reset interaction state fully
     if (activeClone) { // If clearing while moving, remove active clone too
        if (activeClone.geometry) activeClone.geometry.dispose();
        if (activeClone.material && activeClone.material !== originalCloneMaterial && typeof activeClone.material.dispose === 'function') activeClone.material.dispose();
         scene.remove(activeClone);
         activeClone = null;
     }
     selectedOriginal = null;
     originalSelectedMaterial = null;
     originalCloneMaterial = null;
     isMovingClone = false;
     controls.enabled = true; // Ensure controls are enabled
}
function buildStructure(structureData) {
    clearStructure(); // Clear previous loaded structure AND user-placed bricks AND state
    const decodedData = structureData;
    if (!Array.isArray(decodedData)) { console.error("Structure data passed to buildStructure is not an array:", decodedData); updateStructureInfo("Invalid Structure Data: Not an array"); return; }

    const bricksById = {};
    decodedData.forEach(brickData => { if (brickData && typeof brickData.id !== 'undefined') { bricksById[String(brickData.id)] = brickData; } else { console.warn("Found brick data without an ID:", brickData); } });
    const threeMeshes = {}; const processedBrickIds = {}; const queue = [];
    const baseData = bricksById["1"];
    if (!baseData || baseData.type !== "base") { console.error("Could not find base brick (ID '1', type 'base')."); updateStructureInfo("Missing Base Brick"); return; }
    const baseDef = getBrickDefinition(baseData.type);
    if (!baseDef) { console.error("Invalid brick type for base:", baseData.type); updateStructureInfo("Invalid Base Type"); return; }

    const baseGeometry = new THREE.BoxGeometry(baseDef.Size.x, baseDef.Size.y, baseDef.Size.z);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: getBrickColorHex(baseData.colour), roughness: 0.8, metalness: 0.1 });
    basePlateMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    basePlateMesh.position.set(0, GRID_Y_POSITION, 0);
    scene.add(basePlateMesh);
    threeMeshes[baseData.id] = basePlateMesh; processedBrickIds[baseData.id] = true; queue.push(baseData.id);

    while (queue.length > 0) {
        const currentBrickId = queue.shift(); const currentBrickData = bricksById[currentBrickId]; const currentMesh = threeMeshes[currentBrickId];
        if (!currentBrickData || !currentMesh) { continue; }
        const currentBrickDef = getBrickDefinition(currentBrickData.type);
        if (!currentBrickDef || !Array.isArray(currentBrickData.holes)) { continue; }

        currentBrickData.holes.forEach(holeData => {
            if (!holeData || typeof holeData.brick === 'undefined' || typeof holeData.id === 'undefined') { return; }
            const connectedBrickIdStr = String(holeData.brick);
            if (connectedBrickIdStr !== "-1" && isTopHole(currentBrickDef, holeData.id)) {
                if (!processedBrickIds[connectedBrickIdStr]) {
                    const connectedBrickData = bricksById[connectedBrickIdStr];
                    if (connectedBrickData) {
                        const connectedBrickDef = getBrickDefinition(connectedBrickData.type);
                        if (connectedBrickDef) {
                            if (typeof holeData.connectedToHole === 'undefined') { return; }
                            const bottomHoleLocalOffset = currentBrickDef.HoleOffsets(holeData.id);
                            const topHoleLocalOffset = connectedBrickDef.HoleOffsets(holeData.connectedToHole);
                            if (!(bottomHoleLocalOffset instanceof THREE.Vector3) || !(topHoleLocalOffset instanceof THREE.Vector3)) { console.error(`Invalid hole offset calc`); return; }
                            const bottomHoleWorldPos = currentMesh.localToWorld(bottomHoleLocalOffset.clone());
                            const parentQuaternion = new THREE.Quaternion(); currentMesh.getWorldQuaternion(parentQuaternion);
                            const relativeRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.degToRad(holeData.orientation || 0));
                            const worldRotation = parentQuaternion.multiply(relativeRotation);
                            const centerOffset = topHoleLocalOffset.clone().applyQuaternion(worldRotation);
                            const newBrickPosition = bottomHoleWorldPos.clone().sub(centerOffset);
                            const newGeometry = new THREE.BoxGeometry(connectedBrickDef.Size.x, connectedBrickDef.Size.y, connectedBrickDef.Size.z);
                            // IMPORTANT: Use unique materials for build to avoid highlight issues
                            const newMaterial = new THREE.MeshStandardMaterial({ color: getBrickColorHex(connectedBrickData.colour), roughness: 0.8, metalness: 0.1 });
                            const newMesh = new THREE.Mesh(newGeometry, newMaterial);
                            newMesh.position.copy(newBrickPosition); newMesh.quaternion.copy(worldRotation);
                            structureGroup.add(newMesh);
                            threeMeshes[connectedBrickIdStr] = newMesh; processedBrickIds[connectedBrickIdStr] = true; queue.push(connectedBrickIdStr);
                        } else { console.warn("Invalid type def for connected brick:", connectedBrickData.type, "ID:", connectedBrickIdStr); }
                    } else { console.warn("Data not found for connected ID:", connectedBrickIdStr); processedBrickIds[connectedBrickIdStr] = true; }
                }
            }
        });
    }
    console.log("Structure building complete. Parts in loaded structure:", structureGroup.children.length);
}

// --- Structure Cycling --- (cycleStructure, updateStructureInfo - unchanged)
function cycleStructure() {
    if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) { console.warn("Cannot cycle, jsonData not loaded/empty."); return; }
    currentJsonIndex = (currentJsonIndex + 1) % jsonData.length;
    if (!jsonData[currentJsonIndex] || !Array.isArray(jsonData[currentJsonIndex].data)) { console.error(`Data for structure index ${currentJsonIndex} invalid.`); updateStructureInfo(`Error loading structure ${currentJsonIndex + 1}`); return; }
    console.log(`Cycling to structure ${currentJsonIndex + 1}/${jsonData.length}: ${jsonData[currentJsonIndex].name || 'Unnamed'}`);
    buildStructure(jsonData[currentJsonIndex].data);
    updateStructureInfo();
}
function updateStructureInfo(errorMsg = null) {
    const infoSpan = document.getElementById('structureInfo'); if (!infoSpan) return;
    if (errorMsg) { infoSpan.textContent = `Error: ${errorMsg}`; infoSpan.style.color = 'red'; }
    else if (jsonData && Array.isArray(jsonData) && jsonData.length > 0 && jsonData[currentJsonIndex]) {
        const currentName = jsonData[currentJsonIndex].name || `Structure ${currentJsonIndex + 1}`;
        infoSpan.textContent = `Displaying: ${currentName} (${currentJsonIndex + 1}/${jsonData.length})`; infoSpan.style.color = 'white';
    } else { infoSpan.textContent = "Loading data..."; infoSpan.style.color = 'yellow'; }
}

// --- Start Application ---
init();