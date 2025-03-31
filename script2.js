// Import necessary modules from Three.js library
import * as THREE from 'three';
// Import OrbitControls for camera manipulation (pan, zoom, rotate)
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration & Constants ---
const STUD_SIZE = 2;
const PLATE_HEIGHT = 2.4;
const BASE_COLOR = 0xffffff;
const GRID_Y_POSITION = 0; // Y-level of the grid plane for placement

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
const mouse = new THREE.Vector2(); // Normalized device coordinates (-1 to +1)
const gridPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GRID_Y_POSITION); // Plane at Y = GRID_Y_POSITION
const intersectionPoint = new THREE.Vector3(); // Point where ray intersects plane
let isDragging = false;
let clonedMesh = null;
let originalDraggedMaterial = null; // To restore material on drop

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
    controls.screenSpacePanning = false;
    controls.target.set(0, 2, 0);
    // Disable controls when dragging a brick
    controls.addEventListener('start', () => { if (isDragging) controls.enabled = false; });
    controls.addEventListener('end', () => { controls.enabled = true; });


    // --- Optional Grid Helper ---
    // Adjust grid helper position to match the gridPlane Y level
    const gridHelper = new THREE.GridHelper(50, 50 / STUD_SIZE, 0x888888, 0x444444);
    gridHelper.position.y = GRID_Y_POSITION;
    scene.add(gridHelper);

    // Add the structure group to the scene
    scene.add(structureGroup);

    // --- Event Listeners ---
    window.addEventListener('resize', onWindowResize);
    document.getElementById('cycleBtn').addEventListener('click', cycleStructure);
    // Interactivity listeners on the canvas
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault()); // Prevent default right-click menu


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
 * Updates mouse coordinates for raycasting.
 * @param {Event} event - The mouse event.
 */
function updateMouseCoordinates(event) {
    // Calculate mouse position in normalized device coordinates (-1 to +1)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

/**
 * Handles pointer down events (including right-click).
 * Initiates dragging if right-clicking on a structure brick.
 * @param {PointerEvent} event
 */
function onPointerDown(event) {
    // Check if it's the right mouse button (button === 2)
    if (event.button !== 2) {
        return; // Ignore left/middle clicks for dragging
    }

    updateMouseCoordinates(event);
    raycaster.setFromCamera(mouse, camera);

    // Check for intersections with bricks in the loaded structure group
    // Important: We only clone bricks from the original loaded structure for now.
    // If you want to clone user-placed bricks too, add their group/array here.
    const intersects = raycaster.intersectObjects(structureGroup.children);

    if (intersects.length > 0) {
        const intersectedObject = intersects[0].object;

        // Ensure we intersected with a valid mesh part of the structure
        if (intersectedObject.isMesh && structureGroup.children.includes(intersectedObject)) {
            event.preventDefault(); // Prevent potential browser drag behaviors

            isDragging = true;
            controls.enabled = false; // Disable camera controls during drag

            // Clone the intersected mesh
            clonedMesh = intersectedObject.clone();

            // --- Visual Feedback (Optional) ---
            // Make the cloned mesh semi-transparent while dragging
            if (clonedMesh.material) {
                 originalDraggedMaterial = clonedMesh.material; // Store original
                 // Clone material to avoid changing original brick's appearance
                 clonedMesh.material = clonedMesh.material.clone();
                 clonedMesh.material.transparent = true;
                 clonedMesh.material.opacity = 0.6;
            }
            // ----------------------------------

            // Set initial position based on current mouse intersection with grid
            raycaster.ray.intersectPlane(gridPlane, intersectionPoint);
            if (intersectionPoint) { // Check if intersectionPoint is valid
                 snapToGrid(intersectionPoint);
                 clonedMesh.position.copy(intersectionPoint);
            } else {
                // Fallback if no grid intersection initially (should be rare)
                clonedMesh.position.copy(intersectedObject.position); // Start at original pos
                clonedMesh.position.y = GRID_Y_POSITION + PLATE_HEIGHT / 2; // Put on grid level
            }


            // Ensure the clone has standard rotation (optional, depends on desired behavior)
            clonedMesh.rotation.set(0, 0, 0);
            // clonedMesh.quaternion.copy(intersectedObject.quaternion); // Use this to keep original rotation

            // Add the clone to the main scene so it's visible while dragging
            scene.add(clonedMesh);

            console.log("Started dragging clone of:", intersectedObject.uuid);
        }
    }
}

/**
 * Handles pointer move events. Updates the position of the dragged brick.
 * @param {PointerEvent} event
 */
function onPointerMove(event) {
    if (!isDragging || !clonedMesh) {
        return; // Only proceed if currently dragging a mesh
    }

    event.preventDefault();
    updateMouseCoordinates(event);
    raycaster.setFromCamera(mouse, camera);

    // Find intersection with the grid plane
    if (raycaster.ray.intersectPlane(gridPlane, intersectionPoint)) {
        // Snap the intersection point to the grid
        snapToGrid(intersectionPoint);
        // Update the position of the cloned mesh
        clonedMesh.position.copy(intersectionPoint);
    }
}

/**
 * Handles pointer up events. Finalizes the placement of the dragged brick.
 * @param {PointerEvent} event
 */
function onPointerUp(event) {
    // Check if we were dragging and it's the right mouse button releasing
    if (isDragging && event.button === 2) {

        // Restore original material properties (if changed)
        if (clonedMesh && originalDraggedMaterial) {
             clonedMesh.material.dispose(); // Dispose the cloned transparent material
             clonedMesh.material = originalDraggedMaterial;
             originalDraggedMaterial = null; // Clear reference
        }

        // Final position is already set by the last onPointerMove
        console.log("Placed cloned mesh at:", clonedMesh.position);

        // Note: The cloned mesh is already added to the scene.
        // If you want to group user-added bricks, you could create a
        // separate THREE.Group and add clonedMesh to that group here
        // instead of just leaving it in the main scene.

        // Reset dragging state
        isDragging = false;
        clonedMesh = null; // Clear the reference to the cloned mesh
        controls.enabled = true; // Re-enable camera controls
    }
     // Ensure controls are enabled even if pointerup wasn't the end of a drag
     // (e.g., left click release)
     if (!isDragging) {
         controls.enabled = true;
     }
}

/**
 * Snaps a Vector3 position to the nearest grid point based on STUD_SIZE.
 * Also sets the Y position based on PLATE_HEIGHT.
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
            const yOffset = (holeId <= 2) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2);
            let xOffset = 0; if (holeId === 0 || holeId === 3) xOffset = -1 * STUD_SIZE;
            if (holeId === 2 || holeId === 5) xOffset = 1 * STUD_SIZE; const zOffset = 0;
            return new THREE.Vector3(xOffset, yOffset, zOffset);
        }, TopHoleIds: [0, 1, 2], BottomHoleIds: [3, 4, 5]
    },
    "2x1": {
        Size: new THREE.Vector3(2 * STUD_SIZE, PLATE_HEIGHT, 1 * STUD_SIZE),
        HoleOffsets: function(holeId) {
            const yOffset = (holeId <= 1) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2);
            const xOffset = (holeId === 0 || holeId === 2) ? (-0.5 * STUD_SIZE) : (0.5 * STUD_SIZE);
            const zOffset = 0; return new THREE.Vector3(xOffset, yOffset, zOffset);
        }, TopHoleIds: [0, 1], BottomHoleIds: [2, 3]
    },
    "1x1": {
        Size: new THREE.Vector3(1 * STUD_SIZE, PLATE_HEIGHT, 1 * STUD_SIZE),
        HoleOffsets: function(holeId) {
            const yOffset = (holeId === 0) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2);
            const xOffset = 0; const zOffset = 0; return new THREE.Vector3(xOffset, yOffset, zOffset);
        }, TopHoleIds: [0], BottomHoleIds: [1]
    }
};
const COLOR_MAP = { "white": 0xffffff, "yellow": 0xffff00, "blue": 0x0000ff, "orange": 0xffa500, "pink": 0xffc0cb, "purple": 0x800080, "green": 0x00ff00, "default": 0x888888 };
function getBrickDefinition(brickType) { return BRICK_DEFINITIONS[brickType]; }
function getBrickColorHex(colorName) { return COLOR_MAP[colorName?.toLowerCase()] || COLOR_MAP["default"]; }
function isTopHole(brickDef, holeId) { if (!brickDef) return false; if (brickDef.IsBase) return true; if (!brickDef.TopHoleIds) return false; return brickDef.TopHoleIds.includes(holeId); }

// --- Build Logic --- (clearStructure, buildStructure - largely unchanged, uses structureData array)
function clearStructure() {
    while (structureGroup.children.length > 0) {
        const child = structureGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
        structureGroup.remove(child);
    }
    if (basePlateMesh) {
        scene.remove(basePlateMesh);
        if (basePlateMesh.geometry) basePlateMesh.geometry.dispose();
        if (basePlateMesh.material) basePlateMesh.material.dispose();
        basePlateMesh = null;
    }
    // ALSO CLEAR USER-PLACED BRICKS (added meshes directly to scene)
    const userBricks = scene.children.filter(child => child.isMesh && child !== basePlateMesh && !structureGroup.children.includes(child));
    userBricks.forEach(brick => {
         if (brick.geometry) brick.geometry.dispose();
         if (brick.material) brick.material.dispose();
         scene.remove(brick);
    });

}
function buildStructure(structureData) {
    clearStructure(); // Clear previous loaded structure AND user-placed bricks
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
    // Position base plate according to GRID_Y_POSITION
    basePlateMesh.position.set(0, GRID_Y_POSITION, 0); // Base center is at grid Y level
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
                            const newMaterial = new THREE.MeshStandardMaterial({ color: getBrickColorHex(connectedBrickData.colour), roughness: 0.8, metalness: 0.1 });
                            const newMesh = new THREE.Mesh(newGeometry, newMaterial);
                            newMesh.position.copy(newBrickPosition); newMesh.quaternion.copy(worldRotation);
                            structureGroup.add(newMesh); // Add loaded bricks to the structure group
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
    buildStructure(jsonData[currentJsonIndex].data); // This now also clears user bricks
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