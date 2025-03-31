// Import necessary modules from Three.js library
import * as THREE from 'three';
// Import OrbitControls for camera manipulation (pan, zoom, rotate)
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration & Constants (Mirrors Roblox-like dimensions) ---
const STUD_SIZE = 2;        // Base unit size for studs (doubled for visual clarity)
const PLATE_HEIGHT = 2.4;   // Height of a standard plate (doubled)
const BASE_COLOR = 0xffffff; // Default color for the base plate (white)

// --- Scene Setup Variables ---
let scene, camera, renderer, controls; // Core Three.js components
let basePlateMesh = null;           // Reference to the base plate mesh object
let structureGroup = new THREE.Group(); // Group to hold all bricks *except* the base plate
const container = document.getElementById('container'); // Get the DOM element to render the scene in

// --- Data Variables ---
let jsonData = []; // Will hold the structures loaded from JSON file
let currentJsonIndex = 0; // Index for cycling through structures

/**
 * Initializes the entire Three.js scene, camera, renderer, lighting, controls,
 * loads the structure data, sets up event listeners and the first structure build.
 */
async function init() { // <-- Make init async to use await for fetching data
    // Create the main scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x445566); // Set a dark bluish-grey background color

    // Create a perspective camera
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(15, 20, 25); // Set initial camera position

    // Create the WebGL renderer
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

    // --- Optional Grid Helper ---
    const gridHelper = new THREE.GridHelper(50, 50 / STUD_SIZE, 0x888888, 0x444444);
    gridHelper.position.y = -PLATE_HEIGHT / 2;
    scene.add(gridHelper);

    // Add the structure group to the scene
    scene.add(structureGroup);

    // --- Event Listeners ---
    window.addEventListener('resize', onWindowResize);
    document.getElementById('cycleBtn').addEventListener('click', cycleStructure);

    // --- Load Structure Data ---
    try {
        // Fetch the JSON file
        const response = await fetch('structures.json');
        // Check if the fetch was successful (status code 200-299)
        if (!response.ok) {
            // If status is 404, it means file not found. Otherwise, it's another HTTP error.
            const errorText = response.status === 404 ? 'File not found (404)' : `HTTP error! status: ${response.status}`;
            throw new Error(errorText);
        }
        // Parse the response body as JSON and assign it to our variable
        // Because structures.json `data` field is now a direct array,
        // jsonData will be an array of objects, where each object's `data` property
        // is *already* the array of brick data.
        jsonData = await response.json();
        console.log("Successfully loaded and parsed structures.json");

        // --- Initial Build (only if data loaded successfully) ---
        if (jsonData && Array.isArray(jsonData) && jsonData.length > 0) {
            // Pass the .data property (which is already an array) directly
            buildStructure(jsonData[currentJsonIndex].data);
            updateStructureInfo();
        } else {
             console.warn("No structures found in data file or data format invalid.");
             updateStructureInfo("No structures found in data file.");
             document.getElementById('cycleBtn').disabled = true; // Disable button if no data
        }

    } catch (error) {
        // Handle errors during fetch or parsing
        console.error("Failed to load or parse structures.json:", error);
        updateStructureInfo(`FATAL: Could not load structure data (${error.message})`);
        document.getElementById('cycleBtn').disabled = true; // Disable button on error
        return; // Stop further initialization if data loading failed
    }

     // --- Start Animation Loop (only after successful init and data load) ---
    animate();
}

/**
 * Handles window resize events to keep the aspect ratio correct.
 */
function onWindowResize() {
    // Update camera aspect ratio
    camera.aspect = window.innerWidth / window.innerHeight;
    // Apply the changes to the camera's projection matrix
    camera.updateProjectionMatrix();
    // Update renderer size
    renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * The main animation loop, called repeatedly via requestAnimationFrame.
 */
function animate() {
    // Request the next frame, creating the loop
    requestAnimationFrame(animate);
    // Update controls (needed if damping or autoRotate is enabled)
    controls.update();
    // Render the scene from the perspective of the camera
    renderer.render(scene, camera);
}

// --- Brick Logic ---

/**
 * Defines the properties of different brick types, including their size
 * and the relative positions of their connection holes (studs/anti-studs).
 * Positions are relative to the brick's center.
 * Hole IDs generally follow a pattern: top surface first, then bottom surface.
 */
const BRICK_DEFINITIONS = {
    "base": {
        // Size in studs (X), plate height (Y), studs (Z) multiplied by constants
        Size: new THREE.Vector3(4 * STUD_SIZE, PLATE_HEIGHT, 4 * STUD_SIZE),
        // Function to get the local 3D offset of a hole (stud) on the base plate
        HoleOffsets: function(holeId) {
            const col = holeId % 4; // Column index (0-3)
            const row = Math.floor(holeId / 4); // Row index (0-3)
            // Calculate X offset based on column, centering the grid
            const xOffset = (col - 1.5) * STUD_SIZE;
            // Calculate Z offset based on row, centering the grid
            const zOffset = (row - 1.5) * STUD_SIZE;
            // Y offset is always half the plate height (top surface)
            const yOffset = PLATE_HEIGHT / 2;
            return new THREE.Vector3(xOffset, yOffset, zOffset);
        },
        IsBase: true // Flag indicating this is the base plate
    },
    "3x1": {
        Size: new THREE.Vector3(3 * STUD_SIZE, PLATE_HEIGHT, 1 * STUD_SIZE),
        // Function to get hole offsets for a 3x1 brick
        HoleOffsets: function(holeId) {
            // Top holes (0, 1, 2) are on top surface, bottom holes (3, 4, 5) on bottom
            const yOffset = (holeId <= 2) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2);
            let xOffset = 0; // Center hole by default
            if (holeId === 0 || holeId === 3) xOffset = -1 * STUD_SIZE; // Left hole
            if (holeId === 2 || holeId === 5) xOffset = 1 * STUD_SIZE;  // Right hole
            const zOffset = 0; // No Z offset for a 1-stud wide brick
            return new THREE.Vector3(xOffset, yOffset, zOffset);
        },
        TopHoleIds: [0, 1, 2],    // IDs of holes on the top surface
        BottomHoleIds: [3, 4, 5] // IDs of holes on the bottom surface
    },
    "2x1": {
        Size: new THREE.Vector3(2 * STUD_SIZE, PLATE_HEIGHT, 1 * STUD_SIZE),
        HoleOffsets: function(holeId) {
            const yOffset = (holeId <= 1) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2); // Top (0,1) or bottom (2,3)
            // X offset is +/- half a stud size from the center
            const xOffset = (holeId === 0 || holeId === 2) ? (-0.5 * STUD_SIZE) : (0.5 * STUD_SIZE);
            const zOffset = 0;
            return new THREE.Vector3(xOffset, yOffset, zOffset);
        },
        TopHoleIds: [0, 1],
        BottomHoleIds: [2, 3]
    },
    "1x1": {
        Size: new THREE.Vector3(1 * STUD_SIZE, PLATE_HEIGHT, 1 * STUD_SIZE),
        HoleOffsets: function(holeId) {
            const yOffset = (holeId === 0) ? (PLATE_HEIGHT / 2) : (-PLATE_HEIGHT / 2); // Top (0) or bottom (1)
            const xOffset = 0; // Centered
            const zOffset = 0; // Centered
            return new THREE.Vector3(xOffset, yOffset, zOffset);
        },
        TopHoleIds: [0],
        BottomHoleIds: [1]
    }
    // Add more brick definitions here as needed
};

// Maps color names (strings from JSON) to hexadecimal color values for Three.js materials
const COLOR_MAP = {
    "white": 0xffffff,
    "yellow": 0xffff00,
    "blue": 0x0000ff,
    "orange": 0xffa500,
    "pink": 0xffc0cb,
    "purple": 0x800080,
    "green": 0x00ff00,
    "default": 0x888888 // Medium grey fallback for unknown colors
};

/**
 * Retrieves the definition object for a given brick type string.
 * @param {string} brickType - The type name (e.g., "2x1").
 * @returns {object | undefined} The brick definition object or undefined if not found.
 */
function getBrickDefinition(brickType) {
    return BRICK_DEFINITIONS[brickType];
}

/**
 * Converts a color name string to its corresponding hex value.
 * @param {string | null | undefined} colorName - The color name (case-insensitive).
 * @returns {number} The hex color value (defaults to grey if name is invalid).
 */
function getBrickColorHex(colorName) {
    // Convert name to lowercase and look up, defaulting to "default" color if not found or null/undefined
    return COLOR_MAP[colorName?.toLowerCase()] || COLOR_MAP["default"];
}

/**
 * Checks if a given hole ID corresponds to a top surface hole for a specific brick definition.
 * Used to determine which connections represent placing a brick *on top* of another.
 * @param {object} brickDef - The brick definition object.
 * @param {number} holeId - The hole ID to check.
 * @returns {boolean} True if it's a top hole, false otherwise.
 */
function isTopHole(brickDef, holeId) {
    if (!brickDef) return false; // Added check for valid brickDef
    if (brickDef.IsBase) return true; // All base plate holes are considered "top" for connection purposes
    if (!brickDef.TopHoleIds) return false; // If no top holes defined, it can't be one
    return brickDef.TopHoleIds.includes(holeId); // Check if the ID is in the list of top holes
}


// --- Build Logic ---

/**
 * Removes all previously built bricks (from the structureGroup) and the base plate from the scene.
 * Also disposes of their geometries and materials to free up GPU memory.
 */
function clearStructure() {
    // Remove all children from the structure group
    while (structureGroup.children.length > 0) {
        const child = structureGroup.children[0];
        // If the child has geometry and material, dispose them
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
        structureGroup.remove(child); // Remove from group
    }

    // Remove the base plate mesh if it exists
    if (basePlateMesh) {
        scene.remove(basePlateMesh); // Remove from scene
        // Dispose geometry and material
        if (basePlateMesh.geometry) basePlateMesh.geometry.dispose();
        if (basePlateMesh.material) basePlateMesh.material.dispose();
        basePlateMesh = null; // Clear the reference
    }
    // console.log("Cleared previous structure and base."); // Optional: Keep or remove logging
}

/**
 * Takes the pre-parsed array of brick data and builds the 3D structure.
 * @param {Array} structureData - An array of brick objects representing the structure.
 */
function buildStructure(structureData) {
    // Clear any existing structure first
    clearStructure();

    // Use the input directly (it's already an array from the parsed JSON)
    const decodedData = structureData;

    // Ensure the input data is an array
    if (!Array.isArray(decodedData)) {
        console.error("Structure data passed to buildStructure is not an array:", decodedData);
        updateStructureInfo("Invalid Structure Data: Not an array");
        return;
    }

    // --- Data Preparation ---
    // Create a map for quick lookup of brick data by ID (converted to string)
    const bricksById = {};
    decodedData.forEach(brickData => {
        // Ensure brickData has an id before trying to use it as a key
        if (brickData && typeof brickData.id !== 'undefined') {
            bricksById[String(brickData.id)] = brickData;
        } else {
            console.warn("Found brick data without an ID:", brickData);
        }
    });

    // Map to store created Three.js Meshes, keyed by brick ID
    const threeMeshes = {};
    // Set to keep track of brick IDs that have already been processed and added to the scene
    const processedBrickIds = {};
    // Queue for the Breadth-First Search (BFS) traversal of connected bricks
    const queue = [];

    // --- 1. Process Base Brick ---
    // Find the base brick data (expected ID "1" and type "base")
    const baseData = bricksById["1"];
    if (!baseData || baseData.type !== "base") {
        console.error("Could not find base brick (ID '1', type 'base') in structure data.");
        updateStructureInfo("Missing or incorrect Base Brick in structure");
        return; // Stop if base is missing
    }
    // Get the definition for the base brick
    const baseDef = getBrickDefinition(baseData.type);
    if (!baseDef) {
        console.error("Invalid brick type definition for base:", baseData.type);
        updateStructureInfo("Invalid Base Type Definition");
        return; // Stop if definition is missing
    }

    // Create geometry and material for the base plate
    const baseGeometry = new THREE.BoxGeometry(baseDef.Size.x, baseDef.Size.y, baseDef.Size.z);
    const baseMaterial = new THREE.MeshStandardMaterial({
        color: getBrickColorHex(baseData.colour), // Use color from JSON
        roughness: 0.8, // Slightly rough surface
        metalness: 0.1  // Slightly metallic appearance
    });
    // Create the mesh
    basePlateMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    basePlateMesh.position.set(0, 0, 0); // Center the base plate at the world origin
    scene.add(basePlateMesh); // Add the base plate directly to the scene (not the structureGroup)

    // Store the base mesh, mark it as processed, and add its ID to the queue to start the BFS
    threeMeshes[baseData.id] = basePlateMesh;
    processedBrickIds[baseData.id] = true;
    queue.push(baseData.id);

    // console.log("Created Base Plate for current structure"); // Optional logging

    // --- 2. Process Connections using Breadth-First Search (BFS) ---
    while (queue.length > 0) {
        const currentBrickId = queue.shift(); // Get the next brick ID from the front of the queue
        const currentBrickData = bricksById[currentBrickId]; // Get its data
        const currentMesh = threeMeshes[currentBrickId]; // Get its corresponding Three.js mesh

        // Skip if data or mesh is missing
        if (!currentBrickData || !currentMesh) {
            console.warn(`Skipping processing for brick ID ${currentBrickId} - data or mesh missing.`);
            continue;
        }

        const currentBrickDef = getBrickDefinition(currentBrickData.type); // Get its definition

        // Skip if the brick definition is invalid or has no holes defined
        // Also check if holes is actually an array
        if (!currentBrickDef || !Array.isArray(currentBrickData.holes)) {
             // Don't log error if it simply has no holes (like a final top brick)
             if(!currentBrickDef) console.warn(`Invalid brick definition for type ${currentBrickData.type} (ID: ${currentBrickId})`);
            continue;
        }


        // Iterate through each hole defined for the current brick
        currentBrickData.holes.forEach(holeData => {
            // Basic validation of holeData structure
            if (!holeData || typeof holeData.brick === 'undefined' || typeof holeData.id === 'undefined') {
                console.warn(`Invalid hole data structure found in brick ID ${currentBrickId}:`, holeData);
                return; // Skip this malformed holeData entry
            }

            // Get the ID of the brick connected to this hole (as a string)
            const connectedBrickIdStr = String(holeData.brick);

            // Process connection only if:
            // 1. It connects to another brick (ID is not "-1")
            // 2. The hole on the *current* brick is a TOP hole (meaning the connected brick sits *on* this one)
            // 3. The connected brick hasn't been processed yet
            if (connectedBrickIdStr !== "-1" && isTopHole(currentBrickDef, holeData.id)) {
                if (!processedBrickIds[connectedBrickIdStr]) {
                    // Get the data and definition for the connected brick
                    const connectedBrickData = bricksById[connectedBrickIdStr];
                    if (connectedBrickData) {
                        const connectedBrickDef = getBrickDefinition(connectedBrickData.type);
                        if (connectedBrickDef) {
                             // Further validation: check if connectedToHole exists
                            if (typeof holeData.connectedToHole === 'undefined') {
                                console.warn(`Missing 'connectedToHole' in connection from ${currentBrickId}:${holeData.id} to ${connectedBrickIdStr}`);
                                return; // Skip this connection
                            }

                            // --- Core Placement Logic ---
                            // console.log(`  Found connection: ${currentBrickId} (Hole ${holeData.id}) -> ${connectedBrickIdStr} (Hole ${holeData.connectedToHole}) @ ${holeData.orientation} deg`); // Optional logging

                            // Get the local position offset of the connection hole on the current (bottom) brick
                            const bottomHoleLocalOffset = currentBrickDef.HoleOffsets(holeData.id);
                            // Get the local position offset of the corresponding connection hole on the connected (top) brick
                            const topHoleLocalOffset = connectedBrickDef.HoleOffsets(holeData.connectedToHole);

                             // Check if hole offsets are valid Vector3s before proceeding
                            if (!(bottomHoleLocalOffset instanceof THREE.Vector3) || !(topHoleLocalOffset instanceof THREE.Vector3)) {
                                console.error(`Invalid hole offset calculation for connection ${currentBrickId}:${holeData.id} -> ${connectedBrickIdStr}:${holeData.connectedToHole}. Bottom: ${bottomHoleLocalOffset}, Top: ${topHoleLocalOffset}`);
                                return; // Skip this connection
                            }

                            // Calculate the WORLD position of the connection point on the current (bottom) brick's surface
                            const bottomHoleWorldPos = currentMesh.localToWorld(bottomHoleLocalOffset.clone());

                            // Calculate the WORLD rotation of the new (top) brick
                            const parentQuaternion = new THREE.Quaternion();
                            currentMesh.getWorldQuaternion(parentQuaternion);

                            const relativeRotation = new THREE.Quaternion().setFromAxisAngle(
                                new THREE.Vector3(0, 1, 0), // Rotation axis is Y (up)
                                -THREE.MathUtils.degToRad(holeData.orientation || 0) // Use 0 if orientation is missing/undefined/null
                            );

                            const worldRotation = parentQuaternion.multiply(relativeRotation);

                            // Calculate the world position adjustment
                            const centerOffset = topHoleLocalOffset.clone().applyQuaternion(worldRotation);
                            const newBrickPosition = bottomHoleWorldPos.clone().sub(centerOffset);

                            // Create the new Three.js Mesh for the connected brick
                            const newGeometry = new THREE.BoxGeometry(connectedBrickDef.Size.x, connectedBrickDef.Size.y, connectedBrickDef.Size.z);
                            const newMaterial = new THREE.MeshStandardMaterial({
                                color: getBrickColorHex(connectedBrickData.colour),
                                roughness: 0.8,
                                metalness: 0.1
                            });
                            const newMesh = new THREE.Mesh(newGeometry, newMaterial);

                            // Apply the calculated world position and rotation
                            newMesh.position.copy(newBrickPosition);
                            newMesh.quaternion.copy(worldRotation);

                            // Add the newly created brick mesh to the structure group
                            structureGroup.add(newMesh);
                            // console.log(`    Created Brick ${connectedBrickIdStr} at`, newMesh.position.toArray().map(n => n.toFixed(2))); // Optional logging


                            // Store the new mesh, mark its ID as processed, and add it to the queue
                            threeMeshes[connectedBrickIdStr] = newMesh;
                            processedBrickIds[connectedBrickIdStr] = true;
                            queue.push(connectedBrickIdStr);
                            // --- End Core Placement Logic ---
                        } else {
                            console.warn("Invalid brick type definition for connected brick:", connectedBrickData.type, "ID:", connectedBrickIdStr);
                        }
                    } else {
                        // This indicates an issue in the JSON data - a brick ID is referenced that doesn't exist in the structure array
                        console.warn("Data not found for connected brick ID:", connectedBrickIdStr, "referenced from brick", currentBrickId, "(Hole", holeData.id, ")");
                        // Mark as processed to avoid infinite loops if data is cyclically broken
                        processedBrickIds[connectedBrickIdStr] = true;
                    }
                } // End if (!processedBrickIds...)
            } // End if (is valid top connection...)
        }); // End forEach hole
    } // End while (queue.length > 0)

    console.log("Structure building complete. Parts in structure group:", structureGroup.children.length); // Optional logging
}


// --- Structure Cycling ---

/**
 * Cycles to the next JSON structure in the `jsonData` array, rebuilds the scene,
 * and updates the UI information. Wraps around to the beginning if at the end.
 */
function cycleStructure() {
    // Check if jsonData is loaded and has items
    if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
        console.warn("Cannot cycle structure, jsonData is not loaded or empty.");
        return;
    }
    // Increment index and wrap around using the modulo operator
    currentJsonIndex = (currentJsonIndex + 1) % jsonData.length;

    // Check if the current structure data exists and has a 'data' property which is an array
    if (!jsonData[currentJsonIndex] || !Array.isArray(jsonData[currentJsonIndex].data)) {
         console.error(`Data for structure index ${currentJsonIndex} is invalid or missing 'data' array.`);
         updateStructureInfo(`Error loading structure ${currentJsonIndex + 1}`);
         // Optionally, try cycling again or disable button
         return;
    }

    console.log(`Cycling to structure ${currentJsonIndex + 1}/${jsonData.length}: ${jsonData[currentJsonIndex].name || 'Unnamed Structure'}`);

    // Rebuild the structure with the new JSON data array (pass the .data field directly)
    buildStructure(jsonData[currentJsonIndex].data);

    // Update the info text in the UI
    updateStructureInfo();
}

/**
 * Updates the text content of the #structureInfo span element.
 * Displays the current structure name and index, or an error message.
 * @param {string | null} [errorMsg=null] - An optional error message to display instead.
 */
function updateStructureInfo(errorMsg = null) {
    const infoSpan = document.getElementById('structureInfo');
    if (!infoSpan) return; // Exit if the element doesn't exist

    if (errorMsg) {
        // Display error message in red
        infoSpan.textContent = `Error: ${errorMsg}`;
        infoSpan.style.color = 'red';
    } else if (jsonData && Array.isArray(jsonData) && jsonData.length > 0 && jsonData[currentJsonIndex]) {
        // Display normal info text in white if data is available
        const currentName = jsonData[currentJsonIndex].name || `Structure ${currentJsonIndex + 1}`;
        infoSpan.textContent = `Displaying: ${currentName} (${currentJsonIndex + 1}/${jsonData.length})`;
        infoSpan.style.color = 'white';
    } else {
        // Default message if data isn't loaded yet or is empty/invalid
        infoSpan.textContent = "Loading structure data...";
        infoSpan.style.color = 'yellow'; // Or white, depending on preference
    }
}

// --- Start Application ---
// Call the async init function to start loading data and setting up the scene
init();
// Note: animate() is now called at the end of the successful init() function