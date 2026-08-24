document.addEventListener("DOMContentLoaded", function () {
    // Accessibility check
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const canvas = document.getElementById("bgCanvas");
    if (!canvas) return;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0f1115, 0.015);

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, 5, 40);
    camera.lookAt(0, 5, 0);

    const renderer = new THREE.WebGLRenderer({ 
        canvas: canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    // --- Skeleton Data (Seated Driver Posture) ---
    // Coordinates representing a human sitting, reaching forward to a steering wheel
    const joints = [
        { name: "pelvis", pos: [0, 0, 0] },
        { name: "spine_lower", pos: [0, 2, -1] },
        { name: "spine_mid", pos: [0, 4, -1.5] },
        { name: "spine_upper", pos: [0, 6, -2] },
        { name: "neck", pos: [0, 7.5, -1.5] },
        { name: "head", pos: [0, 9.5, -1] },
        
        { name: "shoulder_l", pos: [-2, 6, -2] },
        { name: "elbow_l", pos: [-3, 3, 1] },
        { name: "wrist_l", pos: [-1.5, 4.5, 4.5] },
        
        { name: "shoulder_r", pos: [2, 6, -2] },
        { name: "elbow_r", pos: [3, 3, 1] },
        { name: "wrist_r", pos: [1.5, 4.5, 4.5] },
        
        { name: "hip_l", pos: [-1.5, -0.5, 0.5] },
        { name: "knee_l", pos: [-1.5, 1, 5] },
        { name: "ankle_l", pos: [-1.5, -4, 6] },
        
        { name: "hip_r", pos: [1.5, -0.5, 0.5] },
        { name: "knee_r", pos: [1.5, 1, 5] },
        { name: "ankle_r", pos: [1.5, -4, 6] }
    ];

    const boneConnections = [
        ["pelvis", "spine_lower"],
        ["spine_lower", "spine_mid"],
        ["spine_mid", "spine_upper"],
        ["spine_upper", "neck"],
        ["neck", "head"],
        
        ["spine_upper", "shoulder_l"],
        ["shoulder_l", "elbow_l"],
        ["elbow_l", "wrist_l"],
        
        ["spine_upper", "shoulder_r"],
        ["shoulder_r", "elbow_r"],
        ["elbow_r", "wrist_r"],
        
        ["pelvis", "hip_l"],
        ["hip_l", "knee_l"],
        ["knee_l", "ankle_l"],
        
        ["pelvis", "hip_r"],
        ["hip_r", "knee_r"],
        ["knee_r", "ankle_r"]
    ];

    const getJointIdx = (name) => joints.findIndex(j => j.name === name);

    // --- Shaders for AI Vision Scanning Effect ---
    const vertexShaderBasic = `
        varying vec3 vWorldPosition;
        void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
            gl_PointSize = 7.0 * (40.0 / - (viewMatrix * worldPosition).z);
        }
    `;

    const fragmentShaderBasic = `
        uniform float scanY;
        uniform vec3 colorBase;
        uniform vec3 colorPulse;
        uniform float isPoint;
        
        varying vec3 vWorldPosition;

        void main() {
            if (isPoint > 0.5) {
                float d = distance(gl_PointCoord, vec2(0.5));
                if (d > 0.5) discard;
            }
            
            // Scanning wave: sweeping down diagonally
            float dist = abs((vWorldPosition.y + vWorldPosition.x * 0.2) - scanY);
            float scanIntensity = exp(-dist * dist * 0.15) * 1.5;
            
            vec3 finalColor = mix(colorBase, colorPulse, scanIntensity);
            float alpha = 0.25 + scanIntensity * 0.75; // Faint default state
            
            if (isPoint > 0.5) {
                float d = distance(gl_PointCoord, vec2(0.5));
                alpha *= (1.0 - (d * 2.0));
                alpha *= 1.5; // Boost joint points
            }

            gl_FragColor = vec4(finalColor, min(alpha, 1.0));
        }
    `;

    function createUniforms(isPoint, baseColorHex = 0x1e3a8a) {
        return {
            scanY: { value: -100 },
            colorBase: { value: new THREE.Color(baseColorHex) }, // dim blue
            colorPulse: { value: new THREE.Color(0x60a5fa) }, // bright scan blue
            isPoint: { value: isPoint ? 1.0 : 0.0 }
        };
    }

    const jointUniforms = createUniforms(true, 0x1e3a8a);
    const boneUniforms = createUniforms(false, 0x1e3a8a);

    // --- Build Skeleton Group ---
    const skeletonGroup = new THREE.Group();
    
    // Position on the right side, slightly pushed back
    if (window.innerWidth < 768) {
        skeletonGroup.position.set(10, -5, -15);
        skeletonGroup.scale.set(0.7, 0.7, 0.7);
    } else {
        skeletonGroup.position.set(16, -2, -5);
    }
    // Rotate to face slightly left (three-quarter profile view)
    skeletonGroup.rotation.y = -Math.PI / 5;
    scene.add(skeletonGroup);

    // 1. Joints (Points)
    const jointGeo = new THREE.BufferGeometry();
    const jointPos = new Float32Array(joints.length * 3);
    const jointOrig = new Float32Array(joints.length * 3);
    
    joints.forEach((j, i) => {
        jointPos[i*3] = j.pos[0];
        jointPos[i*3+1] = j.pos[1];
        jointPos[i*3+2] = j.pos[2];
        jointOrig[i*3] = j.pos[0];
        jointOrig[i*3+1] = j.pos[1];
        jointOrig[i*3+2] = j.pos[2];
    });
    
    jointGeo.setAttribute('position', new THREE.BufferAttribute(jointPos, 3));
    
    const jointMat = new THREE.ShaderMaterial({
        vertexShader: vertexShaderBasic,
        fragmentShader: fragmentShaderBasic,
        uniforms: jointUniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false
    });
    
    const jointPoints = new THREE.Points(jointGeo, jointMat);
    skeletonGroup.add(jointPoints);

    // 2. Bones (Lines)
    const boneGeo = new THREE.BufferGeometry();
    const boneIndices = [];
    boneConnections.forEach(conn => {
        const idx1 = getJointIdx(conn[0]);
        const idx2 = getJointIdx(conn[1]);
        if(idx1 !== -1 && idx2 !== -1) boneIndices.push(idx1, idx2);
    });
    
    // Share the position buffer so bones move automatically with joints
    boneGeo.setAttribute('position', jointGeo.getAttribute('position'));
    boneGeo.setIndex(boneIndices);
    
    const boneMat = new THREE.ShaderMaterial({
        vertexShader: vertexShaderBasic,
        fragmentShader: fragmentShaderBasic,
        uniforms: boneUniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false
    });
    
    const boneLines = new THREE.LineSegments(boneGeo, boneMat);
    skeletonGroup.add(boneLines);

    // 3. Depth-Map Effect (Faint Point Cloud following the silhouette)
    const pcCount = window.innerWidth < 768 ? 150 : 350;
    const pcGeo = new THREE.BufferGeometry();
    const pcPos = new Float32Array(pcCount * 3);
    const pcSize = new Float32Array(pcCount);
    
    for(let i = 0; i < pcCount; i++) {
        // Pick a random bone to spawn near
        const conn = boneConnections[Math.floor(Math.random() * boneConnections.length)];
        const j1 = joints[getJointIdx(conn[0])].pos;
        const j2 = joints[getJointIdx(conn[1])].pos;
        
        const t = Math.random();
        let bx = j1[0] + (j2[0] - j1[0]) * t;
        let by = j1[1] + (j2[1] - j1[1]) * t;
        let bz = j1[2] + (j2[2] - j1[2]) * t;
        
        // Spread to create a volumetric "ghost" of the body
        const spread = 2.5;
        pcPos[i*3] = bx + (Math.random() - 0.5) * spread;
        pcPos[i*3+1] = by + (Math.random() - 0.5) * spread;
        pcPos[i*3+2] = bz + (Math.random() - 0.5) * spread;
        pcSize[i] = Math.random() * 2.0 + 1.0;
    }
    pcGeo.setAttribute('position', new THREE.BufferAttribute(pcPos, 3));
    pcGeo.setAttribute('size', new THREE.BufferAttribute(pcSize, 1));
    
    const pcUniforms = createUniforms(true, 0x0f172a); // Very dark slate base
    const pcMat = new THREE.ShaderMaterial({
        vertexShader: `
            attribute float size;
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPosition;
                gl_PointSize = size * (40.0 / - (viewMatrix * worldPosition).z);
            }
        `,
        fragmentShader: fragmentShaderBasic,
        uniforms: pcUniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false
    });
    
    const pointCloud = new THREE.Points(pcGeo, pcMat);
    skeletonGroup.add(pointCloud);

    // --- Interactive Mouse Parallax ---
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;
    
    if (!prefersReducedMotion) {
        document.addEventListener('mousemove', (e) => {
            mouseX = (e.clientX / window.innerWidth) * 2 - 1;
            mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
        });
    }

    // --- Animation Loop ---
    const clock = new THREE.Clock();
    let animationFrameId;
    
    let scanTimer = 0;
    let isScanning = false;
    let currentScanY = -100;

    // Fast lookups for continuous animation
    const headIdx = getJointIdx("head");
    const wristLIdx = getJointIdx("wrist_l");
    const wristRIdx = getJointIdx("wrist_r");
    const spineMidIdx = getJointIdx("spine_mid");
    const spineUpperIdx = getJointIdx("spine_upper");
    const neckIdx = getJointIdx("neck");

    function animate() {
        animationFrameId = requestAnimationFrame(animate);
        const delta = Math.min(clock.getDelta(), 0.1);
        const time = clock.getElapsedTime();
        
        if (!prefersReducedMotion) {
            // 1. Subtle Human Movement (Breathing & Driving adjustments)
            const pos = jointGeo.getAttribute('position').array;
            
            // Breathing expands the spine slightly
            const breath = Math.sin(time * 1.2) * 0.15;
            pos[spineMidIdx*3 + 2] = jointOrig[spineMidIdx*3 + 2] + breath;
            pos[spineUpperIdx*3 + 2] = jointOrig[spineUpperIdx*3 + 2] + breath * 1.5;
            pos[neckIdx*3 + 2] = jointOrig[neckIdx*3 + 2] + breath * 1.8;
            
            // Head looks around very slowly
            pos[headIdx*3] = jointOrig[headIdx*3] + Math.sin(time * 0.4) * 0.4;
            pos[headIdx*3 + 2] = jointOrig[headIdx*3 + 2] + breath * 2.0;

            // Micro-adjustments of hands on steering wheel
            pos[wristLIdx*3 + 1] = jointOrig[wristLIdx*3 + 1] + Math.sin(time * 1.8) * 0.2;
            pos[wristRIdx*3 + 1] = jointOrig[wristRIdx*3 + 1] + Math.cos(time * 2.1) * 0.2;
            
            jointGeo.getAttribute('position').needsUpdate = true;

            // 2. AI Scanning Effect
            if (!isScanning) {
                scanTimer += delta;
                if (scanTimer > 5.0) { // Trigger scan every ~5 seconds
                    isScanning = true;
                    scanTimer = 0;
                    currentScanY = 18; // Start above head
                }
            } else {
                currentScanY -= delta * 15; // Sweep downwards
                if (currentScanY < -15) { // Below feet
                    isScanning = false;
                    currentScanY = -100; // Hide
                }
            }
            
            jointUniforms.scanY.value = currentScanY;
            boneUniforms.scanY.value = currentScanY;
            pcUniforms.scanY.value = currentScanY;

            // 3. Subtle Parallax (Camera shifts around the skeleton)
            targetX = mouseX * 2.0;
            targetY = mouseY * 1.0;
            camera.position.x += (targetX - camera.position.x) * 0.05;
            camera.position.y += ((5 + targetY) - camera.position.y) * 0.05;
            camera.lookAt(0, 5, 0);
        }

        renderer.render(scene, camera);
    }

    // --- Responsiveness ---
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            cancelAnimationFrame(animationFrameId);
        } else {
            clock.getDelta();
            animate();
        }
    });

    animate();
});