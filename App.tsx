import * as React from 'react';
import { ExpoWebGLRenderingContext, GLView } from 'expo-gl';
import { Renderer, THREE } from 'expo-three';
import {
  Scene,
  PerspectiveCamera,
  BoxGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  Mesh,
  AmbientLight,
  DirectionalLight,
  Vector3,
  Group,
  Euler,
  Color,
  BackSide,
  FogExp2,
  Raycaster,
  Box3,
  LineBasicMaterial,
  EdgesGeometry,
  LineSegments,
} from 'three';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Joystick } from './components/Joystick';
import {
  GestureHandlerRootView,
  Gesture,
  GestureDetector,
  GestureTouchEvent,
  TapGestureHandlerEventPayload,
  GestureStateChangeEvent,
  LongPressGestureHandlerEventPayload,
  PanGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';

// Constants for our world
const WORLD_SIZE = 10;
const BLOCK_SIZE = 1;
const GRAVITY = 0.01;
const JUMP_FORCE = 0.15;
const PLAYER_HEIGHT = 1.6;
const PLAYER_WIDTH = 0.6;

// Define block types
type BlockType = 'grass' | 'dirt' | 'stone' | 'bedrock' | 'wood' | 'leaves';

interface Block {
  position: Vector3;
  type: BlockType;
  mesh: Mesh;
  highlightEdges?: LineSegments;
}

export default function App() {
  const worldRef = React.useRef<Group>(new Group());
  const cameraRef = React.useRef<PerspectiveCamera | null>(null);
  const eulerRef = React.useRef(new Euler(0, 0, 0, 'YXZ')); // YXZ order is crucial for FPS controls
  const moveSpeed = 0.1;
  const rotateSpeed = 0.05; // Adjusted for better control

  // Physics state
  const playerVelocity = React.useRef(new Vector3(0, 0, 0));
  const playerOnGround = React.useRef(false);
  const blocks = React.useRef<Block[]>([]);
  const playerCollider = React.useRef(new Box3());

  // Add jump to movement state
  const moveState = React.useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    rotateX: 0,
    rotateY: 0,
    jump: false,
  });

  // Texture references
  const textures = React.useRef<{
    grassTop?: any;
    grassSide?: any;
    dirt?: any;
    stone?: any;
    bedrock?: any;
  }>({});

  // Block colors (as fallback)
  const blockColors = {
    grass: 0x4aca28, // Brighter green for grass top
    dirt: 0x8b5a2b, // Richer brown for dirt
    stone: 0x888888, // Medium gray for stone
    bedrock: 0x333333, // Dark gray for bedrock
    wood: 0x8b4513, // Brown for wood
    leaves: 0x2e8b57, // Sea green for leaves
  };

  // Add state for highlighted block
  const highlightedBlockRef = React.useRef<Block | null>(null);

  // Add state for touch indicator and destruction progress
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const touchVisible = useSharedValue(0);
  const destructionProgress = useSharedValue(0);
  const isDestructionInProgress = useSharedValue(false);

  // Add state to track if we're currently panning for camera control
  const isPanning = useSharedValue(false);

  // Add state for inventory and selected block
  const [inventory, setInventory] = React.useState<
    Array<{ type: BlockType; count: number }>
  >([
    { type: 'grass', count: 64 },
    { type: 'dirt', count: 64 },
    { type: 'stone', count: 64 },
    { type: 'bedrock', count: 64 },
    { type: 'wood', count: 64 },
    { type: 'leaves', count: 64 },
  ]);
  const [selectedBlockIndex, setSelectedBlockIndex] = React.useState(0);

  // Replace the existing panResponder with separate movement and camera controls
  const handleMovementJoystick = (x: number, y: number) => {
    moveState.current.forward = y < -0.2;
    moveState.current.backward = y > 0.2;
    moveState.current.left = x < -0.2;
    moveState.current.right = x > 0.2;
  };

  // Update the handleCameraJoystick function to handle pan gestures
  const handleCameraPan = (x: number, y: number) => {
    // Only update camera rotation if we're panning
    if (isPanning.value) {
      moveState.current.rotateX = x * rotateSpeed * 0.01; // Adjust sensitivity
      moveState.current.rotateY = y * rotateSpeed * 0.01; // Adjust sensitivity
    }
  };

  const handleJoystickRelease = () => {
    moveState.current = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      rotateX: 0,
      rotateY: 0,
      jump: false,
    };
  };

  const handleJump = (value: boolean) => {
    moveState.current.jump = value;

    if (playerOnGround.current && value) {
      playerVelocity.current.y = JUMP_FORCE;
      playerOnGround.current = false;
    }
  };

  const updatePlayerPosition = () => {
    if (!cameraRef.current) return;

    const camera = cameraRef.current;

    // Update rotation
    eulerRef.current.y -= moveState.current.rotateX; // Left/Right rotation
    eulerRef.current.x -= moveState.current.rotateY; // Up/Down rotation

    // Clamp vertical rotation
    const maxVerticalRotation = Math.PI * 0.45; // 81 degrees
    eulerRef.current.x = Math.max(
      -maxVerticalRotation,
      Math.min(maxVerticalRotation, eulerRef.current.x)
    );

    // Apply rotation to camera
    camera.quaternion.setFromEuler(eulerRef.current);

    // Calculate movement direction based on camera rotation
    const forward = new Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    forward.y = 0; // Keep movement horizontal
    forward.normalize();

    const right = new Vector3(1, 0, 0);
    right.applyQuaternion(camera.quaternion);
    right.y = 0; // Keep movement horizontal
    right.normalize();

    // Calculate horizontal movement
    const moveDirection = new Vector3(0, 0, 0);

    if (moveState.current.forward) {
      moveDirection.add(forward);
    }
    if (moveState.current.backward) {
      moveDirection.sub(forward);
    }
    if (moveState.current.left) {
      moveDirection.sub(right);
    }
    if (moveState.current.right) {
      moveDirection.add(right);
    }

    if (moveDirection.length() > 0) {
      moveDirection.normalize().multiplyScalar(moveSpeed);
    }

    // Apply gravity
    if (!playerOnGround.current) {
      playerVelocity.current.y -= GRAVITY;
    }

    // Handle jump
    if (moveState.current.jump && playerOnGround.current) {
      playerVelocity.current.y = JUMP_FORCE;
      playerOnGround.current = false;
    }

    // Update velocity and position
    const newPosition = camera.position.clone();
    newPosition.add(moveDirection);
    newPosition.y += playerVelocity.current.y;

    // Update player collider
    playerCollider.current.setFromCenterAndSize(
      new Vector3(
        newPosition.x,
        newPosition.y - PLAYER_HEIGHT / 2,
        newPosition.z
      ),
      new Vector3(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH)
    );

    // Check collisions with blocks
    let collided = false;
    let onGround = false;

    for (const block of blocks.current) {
      const blockBox = new Box3().setFromObject(block.mesh);

      if (playerCollider.current.intersectsBox(blockBox)) {
        // Handle vertical collision (ground)
        if (
          playerVelocity.current.y <= 0 &&
          camera.position.y > block.position.y + BLOCK_SIZE
        ) {
          newPosition.y = block.position.y + BLOCK_SIZE + PLAYER_HEIGHT / 2;
          playerVelocity.current.y = 0;
          onGround = true;
        } else {
          // Handle horizontal collision
          collided = true;
        }
      }

      // Check if standing on a block
      const groundRay = new Raycaster(
        camera.position,
        new Vector3(0, -1, 0),
        0,
        PLAYER_HEIGHT / 2 + 0.1
      );

      const intersects = groundRay.intersectObject(block.mesh);
      if (intersects.length > 0) {
        onGround = true;
      }
    }

    playerOnGround.current = onGround;

    // Apply position if no collision
    if (!collided) {
      camera.position.copy(newPosition);
    } else {
      // Only apply Y position for vertical movement
      camera.position.y = newPosition.y;
    }
  };

  // Function to create a pattern on blocks
  const createBlockPattern = (type: BlockType, mesh: Mesh) => {
    // Skip patterns for some blocks to maintain variety
    if (Math.random() > 0.3) return;

    const patternGeometry = new BoxGeometry(
      BLOCK_SIZE * 0.2,
      BLOCK_SIZE * 0.1,
      BLOCK_SIZE * 0.2
    );

    let patternMaterial;
    let count = 0;

    switch (type) {
      case 'grass':
        // Add small grass tufts on top
        patternMaterial = new MeshStandardMaterial({
          color: 0x66dd44,
          roughness: 0.9,
          metalness: 0.0,
        });
        count = Math.floor(Math.random() * 3) + 1;

        break;

      case 'stone':
        // Add small rock details
        patternMaterial = new MeshStandardMaterial({
          color: 0x777777,
          roughness: 0.8,
          metalness: 0.2,
        });

        if (Math.random() > 0.7) {
          const rock = new Mesh(patternGeometry, patternMaterial);
          // Position on top or side of block
          const side = Math.floor(Math.random() * 6);

          if (side === 0) {
            // top
            rock.position.set(
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6,
              BLOCK_SIZE * 0.5,
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6
            );
          } else if (side === 1) {
            // bottom
            rock.position.set(
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6,
              -BLOCK_SIZE * 0.5,
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6
            );
          } else if (side === 2) {
            // front
            rock.position.set(
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6,
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6,
              BLOCK_SIZE * 0.5
            );
          } else if (side === 3) {
            // back
            rock.position.set(
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6,
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6,
              -BLOCK_SIZE * 0.5
            );
          } else if (side === 4) {
            // right
            rock.position.set(
              BLOCK_SIZE * 0.5,
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6,
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6
            );
          } else {
            // left
            rock.position.set(
              -BLOCK_SIZE * 0.5,
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6,
              (Math.random() - 0.5) * BLOCK_SIZE * 0.6
            );
          }

          rock.scale.set(
            0.5 + Math.random() * 0.5,
            0.3 + Math.random() * 0.3,
            0.5 + Math.random() * 0.5
          );
          mesh.add(rock);
        }
        break;

      case 'dirt':
        // Add small pebbles or roots
        if (Math.random() > 0.8) {
          patternMaterial = new MeshStandardMaterial({
            color: Math.random() > 0.5 ? 0x554422 : 0x665533,
            roughness: 0.9,
            metalness: 0.0,
          });

          const pebble = new Mesh(patternGeometry, patternMaterial);
          pebble.position.set(
            (Math.random() - 0.5) * BLOCK_SIZE * 0.7,
            BLOCK_SIZE * 0.5 * (Math.random() - 0.3),
            (Math.random() - 0.5) * BLOCK_SIZE * 0.7
          );
          pebble.scale.set(
            0.3 + Math.random() * 0.3,
            0.2 + Math.random() * 0.2,
            0.3 + Math.random() * 0.3
          );
          mesh.add(pebble);
        }
        break;

      case 'wood':
        // Add wood grain patterns
        patternMaterial = new MeshStandardMaterial({
          color: 0x6b4226, // Darker brown for grain
          roughness: 0.9,
          metalness: 0.0,
        });

        if (Math.random() > 0.5) {
          // Create wood grain lines
          const grainGeometry = new BoxGeometry(
            BLOCK_SIZE * 0.8,
            BLOCK_SIZE * 0.02,
            BLOCK_SIZE * 0.1
          );

          // Add 2-4 grain lines
          const grainCount = Math.floor(Math.random() * 3) + 2;

          for (let i = 0; i < grainCount; i++) {
            const grain = new Mesh(grainGeometry, patternMaterial);
            // Position grain on the sides of the wood block
            grain.position.set(
              0,
              (Math.random() - 0.5) * BLOCK_SIZE * 0.7,
              BLOCK_SIZE * 0.5 * 0.95 // Slightly inset from the surface
            );
            grain.rotation.z = Math.random() * 0.2 - 0.1; // Slight random rotation
            mesh.add(grain);
          }
        }
        break;

      case 'leaves':
        // Add small leaf details
        patternMaterial = new MeshStandardMaterial({
          color: 0x3da35d, // Slightly different green
          roughness: 0.7,
          metalness: 0.0,
          transparent: true,
          opacity: 0.9,
        });

        // Add 3-6 small leaf clusters
        const leafCount = Math.floor(Math.random() * 4) + 3;

        for (let i = 0; i < leafCount; i++) {
          const leafGeometry = new BoxGeometry(
            BLOCK_SIZE * 0.15,
            BLOCK_SIZE * 0.15,
            BLOCK_SIZE * 0.15
          );
          const leaf = new Mesh(leafGeometry, patternMaterial);

          // Position leaves randomly around the block
          leaf.position.set(
            (Math.random() - 0.5) * BLOCK_SIZE * 0.9,
            (Math.random() - 0.5) * BLOCK_SIZE * 0.9,
            (Math.random() - 0.5) * BLOCK_SIZE * 0.9
          );

          // Random rotation for variety
          leaf.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
          );

          mesh.add(leaf);
        }
        break;
    }
  };

  const createBlock = (position: Vector3, type: BlockType) => {
    const geometry = new BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);

    let materials;

    // Add slight random variation to make blocks look more natural
    const colorJitter = () => 1 + (Math.random() * 0.1 - 0.05);

    switch (type) {
      case 'grass':
        // Create different materials for each face of the grass block
        materials = [
          // Right face
          new MeshStandardMaterial({
            color: new Color(blockColors.grass * 0.8).multiplyScalar(
              colorJitter()
            ),
            roughness: 0.8,
            metalness: 0.1,
          }),
          // Left face
          new MeshStandardMaterial({
            color: new Color(blockColors.grass * 0.7).multiplyScalar(
              colorJitter()
            ),
            roughness: 0.8,
            metalness: 0.1,
          }),
          // Top face
          new MeshStandardMaterial({
            color: new Color(blockColors.grass).multiplyScalar(colorJitter()),
            roughness: 0.7,
            metalness: 0.1,
          }),
          // Bottom face
          new MeshStandardMaterial({
            color: new Color(blockColors.dirt).multiplyScalar(colorJitter()),
            roughness: 0.9,
            metalness: 0.1,
          }),
          // Front face
          new MeshStandardMaterial({
            color: new Color(blockColors.grass * 0.9).multiplyScalar(
              colorJitter()
            ),
            roughness: 0.8,
            metalness: 0.1,
          }),
          // Back face
          new MeshStandardMaterial({
            color: new Color(blockColors.grass * 0.85).multiplyScalar(
              colorJitter()
            ),
            roughness: 0.8,
            metalness: 0.1,
          }),
        ];
        break;

      case 'dirt':
        // Single material with slight variation for all faces
        const dirtColor = new Color(blockColors.dirt).multiplyScalar(
          colorJitter()
        );
        materials = new MeshStandardMaterial({
          color: dirtColor,
          roughness: 0.9,
          metalness: 0.1,
        });
        break;

      case 'stone':
        // Single material with slight variation for all faces
        const stoneColor = new Color(blockColors.stone).multiplyScalar(
          colorJitter()
        );
        materials = new MeshStandardMaterial({
          color: stoneColor,
          roughness: 0.7,
          metalness: 0.2,
        });
        break;

      case 'bedrock':
        // Single material with slight variation for all faces
        const bedrockColor = new Color(blockColors.bedrock).multiplyScalar(
          colorJitter()
        );
        materials = new MeshStandardMaterial({
          color: bedrockColor,
          roughness: 0.9,
          metalness: 0.3,
        });
        break;

      case 'wood':
        // Wood has a distinct trunk-like appearance
        const woodColor = new Color(blockColors.wood).multiplyScalar(
          colorJitter()
        );
        materials = new MeshStandardMaterial({
          color: woodColor,
          roughness: 0.8,
          metalness: 0.1,
        });
        break;

      case 'leaves':
        // Leaves are slightly transparent and have a lighter color
        const leavesColor = new Color(blockColors.leaves).multiplyScalar(
          colorJitter()
        );
        materials = new MeshStandardMaterial({
          color: leavesColor,
          roughness: 0.7,
          metalness: 0.0,
          transparent: true,
          opacity: 0.9,
        });
        break;

      default:
        // Fallback to basic material
        materials = new MeshStandardMaterial({
          color: blockColors[type],
          roughness: 0.8,
          metalness: 0.1,
        });
    }

    const mesh = new Mesh(geometry, materials);
    mesh.position.copy(position);

    // Add subtle random rotation for more natural look
    if (type !== 'bedrock') {
      mesh.rotation.y = (Math.floor(Math.random() * 4) * Math.PI) / 2;
    }

    // Add patterns and details to blocks
    createBlockPattern(type, mesh);

    // Add subtle ambient occlusion effect by darkening bottom blocks slightly
    if (Math.random() > 0.7) {
      if (Array.isArray(materials)) {
        materials.forEach((mat) => {
          if (mat.color) mat.color.multiplyScalar(0.9);
        });
      } else if (materials.color) {
        materials.color.multiplyScalar(0.9);
      }
    }

    const block: Block = {
      position,
      type,
      mesh,
    };

    blocks.current.push(block);
    return mesh;
  };

  const generateTerrain = () => {
    const world = worldRef.current;

    // Simple noise function for terrain generation
    const noise = (
      x: number,
      z: number,
      scale: number = 1,
      amplitude: number = 1
    ) => {
      // Simple implementation of Perlin-like noise
      const X = Math.floor(x * scale);
      const Z = Math.floor(z * scale);

      // Generate pseudo-random values based on coordinates
      const dot1 = Math.sin(X * 12.9898 + Z * 78.233) * 43758.5453;
      const dot2 = Math.sin(X * 63.9898 + Z * 23.233) * 93758.5453;

      // Combine and normalize
      return ((Math.sin(dot1) + Math.sin(dot2)) * 0.5 + 0.5) * amplitude;
    };

    // Function to generate a tree at a specific position
    const generateTree = (x: number, z: number, baseHeight: number) => {
      // Create the trunk (3-5 blocks tall)
      const trunkHeight = Math.floor(Math.random() * 3) + 3;

      for (let y = 0; y < trunkHeight; y++) {
        const woodBlock = createBlock(
          new Vector3(x * BLOCK_SIZE, baseHeight + y + 1, z * BLOCK_SIZE),
          'wood'
        );
        world.add(woodBlock);
      }

      // Create the leaves (a roughly spherical shape)
      const leafRadius = Math.floor(Math.random() * 1) + 2; // 2-3 block radius
      const leafHeight = Math.floor(Math.random() * 2) + 2; // 2-3 blocks tall
      const leafStartHeight = trunkHeight - 1; // Start leaves near top of trunk

      // Generate leaves in a roughly spherical pattern
      for (let y = 0; y < leafHeight; y++) {
        const layerRadius =
          y === 0 || y === leafHeight - 1
            ? Math.max(1, leafRadius - 1) // Smaller radius at top and bottom
            : leafRadius;

        for (let lx = -layerRadius; lx <= layerRadius; lx++) {
          for (let lz = -layerRadius; lz <= layerRadius; lz++) {
            // Skip corners to make it more rounded
            if (lx * lx + lz * lz > layerRadius * layerRadius + 1) continue;

            // Random chance to skip some leaves for a more natural look
            if (Math.random() > 0.8) continue;

            const leafBlock = createBlock(
              new Vector3(
                (x + lx) * BLOCK_SIZE,
                baseHeight + leafStartHeight + y,
                (z + lz) * BLOCK_SIZE
              ),
              'leaves'
            );
            world.add(leafBlock);
          }
        }
      }
    };

    // 3D noise function for underground features
    const noise3D = (x: number, y: number, z: number) => {
      // Simple implementation of 3D noise
      const X = Math.floor(x * 0.5);
      const Y = Math.floor(y * 0.5);
      const Z = Math.floor(z * 0.5);

      // Generate pseudo-random values based on coordinates
      const dot = Math.sin(X * 12.9898 + Y * 43.233 + Z * 78.233) * 43758.5453;

      // Normalize to 0-1
      return Math.sin(dot) * 0.5 + 0.5;
    };

    // Generate a more interesting terrain with different layers
    for (let x = 0; x < WORLD_SIZE; x++) {
      for (let z = 0; z < WORLD_SIZE; z++) {
        // Generate height using multiple layers of noise
        const baseHeight =
          noise(x, z, 0.1, 4) + // Large hills
          noise(x, z, 0.2, 2) + // Medium features
          noise(x, z, 0.5, 1); // Small details

        // Round to integer and add base height
        const height = Math.floor(baseHeight) - 2;

        // Determine block type for the top layer
        let topBlockType: BlockType = 'grass';

        // Occasionally create stone outcroppings
        if (noise(x, z, 0.3, 1) > 0.8 && baseHeight > 3) {
          topBlockType = 'stone';
        }

        // Add top block
        const topBlock = createBlock(
          new Vector3(x * BLOCK_SIZE, height, z * BLOCK_SIZE),
          topBlockType
        );
        world.add(topBlock);

        // Determine dirt layer depth (1-3 blocks)
        const dirtDepth =
          topBlockType === 'stone'
            ? 1 // Less dirt under stone
            : Math.floor(noise(x, z, 0.4, 2)) + 2; // 2-3 blocks under grass

        // Add dirt below top layer
        for (let y = 1; y <= dirtDepth; y++) {
          const dirtBlock = createBlock(
            new Vector3(x * BLOCK_SIZE, height - y, z * BLOCK_SIZE),
            'dirt'
          );
          world.add(dirtBlock);
        }

        // Add stone below dirt down to bedrock level
        const bedrockLevel = -7;
        for (let y = dirtDepth + 1; y <= Math.abs(bedrockLevel - height); y++) {
          // Occasionally add dirt pockets in stone
          const blockType = noise3D(x, y, z) > 0.9 ? 'dirt' : 'stone';

          const stoneBlock = createBlock(
            new Vector3(x * BLOCK_SIZE, height - y, z * BLOCK_SIZE),
            blockType
          );
          world.add(stoneBlock);
        }

        // Add bedrock at the bottom
        const bedrockBlock = createBlock(
          new Vector3(x * BLOCK_SIZE, bedrockLevel, z * BLOCK_SIZE),
          'bedrock'
        );
        world.add(bedrockBlock);

        // Randomly generate trees on grass blocks (but not too close to edges)
        if (
          topBlockType === 'grass' &&
          x > 2 &&
          x < WORLD_SIZE - 3 &&
          z > 2 &&
          z < WORLD_SIZE - 3 &&
          Math.random() < 0.05 // 3% chance for a tree
        ) {
          generateTree(x, z, height);
        }
      }
    }

    return world;
  };

  const createSkybox = () => {
    const geometry = new BoxGeometry(1000, 1000, 1000);
    const material = new MeshBasicMaterial({
      color: new Color('#87CEEB'), // Light sky blue
      side: BackSide, // Render on the inside of the cube
    });
    return new Mesh(geometry, material);
  };

  // Add function to highlight a block
  const highlightBlock = (block: Block) => {
    // Remove highlight from previously highlighted block if any
    if (
      highlightedBlockRef.current &&
      highlightedBlockRef.current.highlightEdges
    ) {
      highlightedBlockRef.current.mesh.remove(
        highlightedBlockRef.current.highlightEdges
      );
      highlightedBlockRef.current.highlightEdges = undefined;
    }

    // Set new highlighted block
    highlightedBlockRef.current = block;

    // Create edges geometry for the block
    const edgesGeometry = new EdgesGeometry(block.mesh.geometry);
    const edgesMaterial = new LineBasicMaterial({
      color: 0xffffff,
      linewidth: 2,
    });
    const edges = new LineSegments(edgesGeometry, edgesMaterial);

    // Add edges to the block mesh
    block.mesh.add(edges);
    block.highlightEdges = edges;
  };

  // Add function to show touch indicator
  const showTouchIndicator = (x: number, y: number) => {
    touchX.value = x;
    touchY.value = y;
    touchVisible.value = 1;

    // Hide after a short delay
    touchVisible.value = withDelay(500, withTiming(0, { duration: 300 }));
  };

  // Add function to start destruction progress
  const startDestructionProgress = (x: number, y: number) => {
    touchX.value = x;
    touchY.value = y;
    touchVisible.value = 1;
    isDestructionInProgress.value = true;
    destructionProgress.value = 0;

    // First highlight the block that's being targeted
    highlightBlockAtPosition(x, y);

    // Animate progress from 0 to 1 over 800ms
    destructionProgress.value = withTiming(
      1,
      {
        duration: 800,
        easing: Easing.linear,
      },
      (finished) => {
        if (finished) {
          // When animation completes, trigger block destruction
          runOnJS(destroyBlockAtPosition)(x, y);
        }
      }
    );
  };

  // Add function to highlight block at specific position
  const highlightBlockAtPosition = (x: number, y: number) => {
    if (!cameraRef.current || !worldRef.current) return;

    // Get the screen dimensions
    const { width, height } = Dimensions.get('window');

    // Convert touch position to normalized device coordinates (-1 to +1)
    const normalizedX = (x / width) * 2 - 1;
    const normalizedY = -(y / height) * 2 + 1; // Y is inverted

    // Create raycaster from camera using the touch position
    const raycaster = new Raycaster();
    raycaster.setFromCamera(
      { x: normalizedX, y: normalizedY },
      cameraRef.current
    );

    // Check for intersections with blocks
    const intersects = raycaster.intersectObjects(
      blocks.current.map((block) => block.mesh),
      false
    );

    if (intersects.length > 0) {
      // Find the block that was clicked
      const clickedMesh = intersects[0].object;
      const clickedBlock = blocks.current.find(
        (block) => block.mesh === clickedMesh
      );

      if (clickedBlock) {
        console.log('Highlighting block at position:', clickedBlock.position);
        highlightBlock(clickedBlock);
      }
    }
  };

  // Add function to destroy block at specific position
  const destroyBlockAtPosition = (x: number, y: number) => {
    if (!cameraRef.current || !worldRef.current) return;

    // Reset destruction progress
    isDestructionInProgress.value = false;
    destructionProgress.value = 0;
    touchVisible.value = withTiming(0, { duration: 300 });

    // Get the screen dimensions
    const { width, height } = Dimensions.get('window');

    // Convert touch position to normalized device coordinates (-1 to +1)
    const normalizedX = (x / width) * 2 - 1;
    const normalizedY = -(y / height) * 2 + 1; // Y is inverted

    // Create raycaster from camera using the touch position
    const raycaster = new Raycaster();
    raycaster.setFromCamera(
      { x: normalizedX, y: normalizedY },
      cameraRef.current
    );

    // Check for intersections with blocks
    const intersects = raycaster.intersectObjects(
      blocks.current.map((block) => block.mesh),
      false
    );

    if (intersects.length > 0) {
      // Find the block that was clicked
      const clickedMesh = intersects[0].object;
      const clickedBlock = blocks.current.find(
        (block) => block.mesh === clickedMesh
      );

      if (clickedBlock) {
        console.log('Destroying block at position:', clickedBlock.position);

        // Remove the block from the scene
        worldRef.current.remove(clickedBlock.mesh);

        // Remove the block from our blocks array
        blocks.current = blocks.current.filter(
          (block) => block !== clickedBlock
        );

        // If this was the highlighted block, clear the highlight reference
        if (highlightedBlockRef.current === clickedBlock) {
          highlightedBlockRef.current = null;
        }
      }
    }
  };

  // Add function to add a block at the position where the user taps
  const addBlockAtPosition = (x: number, y: number) => {
    if (!cameraRef.current || !worldRef.current) return;
    if (selectedBlockIndex === null || selectedBlockIndex === undefined) return;
    if (inventory[selectedBlockIndex].count <= 0) return;

    // Get the screen dimensions
    const { width, height } = Dimensions.get('window');

    // Convert touch position to normalized device coordinates (-1 to +1)
    const normalizedX = (x / width) * 2 - 1;
    const normalizedY = -(y / height) * 2 + 1; // Y is inverted

    // Create raycaster from camera using the touch position
    const raycaster = new Raycaster();
    raycaster.setFromCamera(
      { x: normalizedX, y: normalizedY },
      cameraRef.current
    );

    // Check for intersections with blocks
    const intersects = raycaster.intersectObjects(
      blocks.current.map((block) => block.mesh),
      false
    );

    if (intersects.length > 0) {
      // Find the block that was clicked
      const clickedMesh = intersects[0].object;
      const clickedBlock = blocks.current.find(
        (block) => block.mesh === clickedMesh
      );

      if (clickedBlock) {
        // Calculate the position for the new block based on the face that was clicked
        const face = intersects[0].face;
        if (!face) return;

        // Get the normal of the face that was clicked
        const normal = face.normal.clone();

        // Transform the normal from local space to world space
        normal.transformDirection(clickedMesh.matrixWorld);

        // Calculate the position for the new block
        const newPosition = clickedBlock.position
          .clone()
          .add(normal.multiplyScalar(BLOCK_SIZE));

        // Check if there's already a block at this position
        const blockExists = blocks.current.some(
          (block) =>
            block.position.x === newPosition.x &&
            block.position.y === newPosition.y &&
            block.position.z === newPosition.z
        );

        if (!blockExists) {
          console.log('Adding block at position:', newPosition);

          // Get the selected block type from inventory
          const selectedBlockType = inventory[selectedBlockIndex].type;

          // Create the new block
          const newBlockMesh = createBlock(newPosition, selectedBlockType);

          // Add the new block to the scene
          worldRef.current.add(newBlockMesh);

          // Decrease the count of the selected block in inventory
          const updatedInventory = [...inventory];
          if (updatedInventory[selectedBlockIndex].count > 0) {
            updatedInventory[selectedBlockIndex].count--;
            setInventory(updatedInventory);
          }
        }
      }
    }
  };

  // Add function to cancel destruction progress
  const cancelDestructionProgress = () => {
    if (isDestructionInProgress.value) {
      cancelAnimation(destructionProgress);
      destructionProgress.value = withTiming(0, { duration: 200 });
      isDestructionInProgress.value = false;
      touchVisible.value = withTiming(0, { duration: 300 });
    }
  };

  // Animated style for touch indicator
  const touchIndicatorStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: touchX.value }, { translateY: touchY.value }],
      opacity: touchVisible.value,
    };
  });

  // Animated style for destruction progress
  const destructionProgressStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: touchX.value },
        { translateY: touchY.value - 70 }, // Offset upward by 70 pixels to be visible above the finger
      ],
      opacity: isDestructionInProgress.value ? 1 : 0,
      width: 80, // Increased from 50 to 80
      height: 80, // Increased from 50 to 80
      borderRadius: 40, // Half of width/height
      borderWidth: 4, // Increased from 3 to 4
      borderColor: 'rgba(255, 0, 0, 0.7)',
      position: 'absolute',
      marginLeft: -40, // Half of width
      marginTop: -40, // Half of height
    };
  });

  // Animated style for progress fill
  const progressFillStyle = useAnimatedStyle(() => {
    return {
      width: 72, // Increased from 44 to 72
      height: 72, // Increased from 44 to 72
      borderRadius: 36, // Half of width/height
      backgroundColor: 'rgba(255, 0, 0, 0.3)',
      transform: [{ scale: destructionProgress.value }],
    };
  });

  // Update the handleBlockSelection function to handle both building and destroying blocks
  const handleBlockSelection = (
    event: GestureStateChangeEvent<TapGestureHandlerEventPayload>
  ) => {
    if (!cameraRef.current || !worldRef.current) return;

    // Get the touch coordinates
    const touchX = event.x;
    const touchY = event.y;

    // Show touch indicator
    showTouchIndicator(touchX, touchY);

    console.log('Touch position:', { touchX, touchY, event });

    // If it's a tap (not a long press) and we have a selected block with inventory, add a block
    if (
      event.state === 5 && // 5 is the END state for gestures
      selectedBlockIndex !== null &&
      selectedBlockIndex !== undefined &&
      inventory[selectedBlockIndex].count > 0
    ) {
      addBlockAtPosition(touchX, touchY);
    } else {
      // Otherwise, just highlight the block
      highlightBlockAtPosition(touchX, touchY);
    }
  };

  // Add function to start camera panning
  const startCameraPan = () => {
    isPanning.value = true;
  };

  // Add function to stop camera panning
  const stopCameraPan = () => {
    isPanning.value = false;
    moveState.current.rotateX = 0;
    moveState.current.rotateY = 0;
  };

  // Function to handle block selection from inventory
  const selectBlockFromInventory = (index: number) => {
    setSelectedBlockIndex(index);
    console.log(`Selected block: ${inventory[index].type}`);
  };

  // Function to get block color for UI display
  const getBlockColor = (type: BlockType): string => {
    switch (type) {
      case 'grass':
        return '#4aca28';
      case 'dirt':
        return '#8b5a2b';
      case 'stone':
        return '#888888';
      case 'bedrock':
        return '#333333';
      case 'wood':
        return '#8B4513';
      case 'leaves':
        return '#2E8B57';
      default:
        return '#ffffff';
    }
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <GestureDetector
          gesture={Gesture.Race(
            // Pan gesture for camera control - make it higher priority
            Gesture.Pan()
              .minDistance(10) // Require minimum movement to be considered a pan
              .onStart(() => {
                runOnJS(startCameraPan)();
              })
              .onUpdate((event) => {
                runOnJS(handleCameraPan)(event.velocityX, event.velocityY);
              })
              .onEnd(() => {
                runOnJS(stopCameraPan)();
              })
              .onFinalize(() => {
                runOnJS(stopCameraPan)();
              }),

            // Block interaction gestures
            Gesture.Exclusive(
              Gesture.Tap()
                .maxDistance(10) // Limit the distance for a tap to be recognized
                .onEnd((event) => {
                  runOnJS(handleBlockSelection)(event);
                }),
              Gesture.LongPress()
                .minDuration(500)
                .maxDistance(10) // Limit the distance for a long press to be recognized
                .onBegin((event) => {
                  runOnJS(handleBlockSelection)(event);
                })
                .onStart((event) => {
                  runOnJS(startDestructionProgress)(event.x, event.y);
                })
                .onEnd((event) => {
                  // If the long press completes successfully, destroy the block
                  if (event.state === 5) {
                    // 5 is the END state for gestures
                    runOnJS(destroyBlockAtPosition)(event.x, event.y);
                  } else {
                    // Otherwise cancel the destruction progress
                    runOnJS(cancelDestructionProgress)();
                  }
                })
                .onFinalize(() => {
                  // Make sure to cancel destruction progress if the gesture is interrupted
                  runOnJS(cancelDestructionProgress)();
                })
            )
          )}
        >
          <GLView
            style={{ flex: 1 }}
            onContextCreate={(gl: ExpoWebGLRenderingContext) => {
              const renderer = new Renderer({ gl }) as any;
              renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);

              // In React Native, we can't use the Canvas API
              // Instead, we'll use simple color materials with different properties

              // Create texture references with null values
              textures.current = {
                grassTop: null,
                grassSide: null,
                dirt: null,
                stone: null,
                bedrock: null,
              };

              const scene = new Scene();
              scene.background = new Color('#87CEEB'); // Set scene background color

              // Add fog to the scene
              const fogColor = new Color('#87CEEB'); // Match fog color to sky
              scene.fog = new FogExp2(fogColor, 0.01); // Exponential fog with density 0.05

              // Create and add skybox
              const skybox = createSkybox();
              scene.add(skybox);

              const camera = new PerspectiveCamera(
                75,
                gl.drawingBufferWidth / gl.drawingBufferHeight,
                0.1,
                1000
              );
              cameraRef.current = camera;

              // Position camera at player height above the terrain
              // Adjust starting position to be above the terrain
              camera.position.set(WORLD_SIZE / 2, 5, WORLD_SIZE / 2); // Start higher to avoid spawning underground
              camera.lookAt(WORLD_SIZE / 2, 5, 0);

              // Generate and add terrain
              const world = generateTerrain();
              worldRef.current = world;
              scene.add(world);

              // Enhanced lighting setup
              const ambientLight = new AmbientLight(0x777777, 0.5); // Softer ambient light
              scene.add(ambientLight);

              // Main sun-like directional light
              const mainLight = new DirectionalLight(0xffffcc, 1.0); // Warm sunlight
              mainLight.position.set(50, 100, 30);
              scene.add(mainLight);

              // Secondary fill light (opposite direction)
              const fillLight = new DirectionalLight(0x8888ff, 0.3); // Slight blue tint for sky reflection
              fillLight.position.set(-50, 80, -30);
              scene.add(fillLight);

              // Ground bounce light (subtle)
              const bounceLight = new DirectionalLight(0x88cc88, 0.2); // Slight green tint for grass reflection
              bounceLight.position.set(0, -10, 0);
              scene.add(bounceLight);

              // Updated animation loop with movement
              const animate = () => {
                requestAnimationFrame(animate);
                updatePlayerPosition();
                renderer.render(scene, camera);
                gl.endFrameEXP();
              };

              animate();
            }}
          />
        </GestureDetector>

        {/* Touch indicator */}
        <Animated.View style={[styles.touchIndicator, touchIndicatorStyle]} />

        {/* Destruction progress indicator */}
        <Animated.View style={destructionProgressStyle}>
          <Animated.View style={progressFillStyle} />
        </Animated.View>

        {/* Inventory HUD */}
        <View style={styles.inventoryContainer}>
          {inventory.map((item, index) => (
            <TouchableOpacity
              key={`${item.type}-${index}`}
              style={[
                styles.inventoryCell,
                selectedBlockIndex === index && styles.selectedInventoryCell,
              ]}
              onPress={() => selectBlockFromInventory(index)}
            >
              <View
                style={[
                  styles.blockPreview,
                  { backgroundColor: getBlockColor(item.type) },
                ]}
              />
              <Text style={styles.blockCount}>{item.count}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Joystick
          size={150}
          position='left'
          onMove={handleMovementJoystick}
          onRelease={handleJoystickRelease}
        />

        {/* Simple Jump Button */}
        <GestureDetector
          gesture={Gesture.Tap()
            .simultaneousWithExternalGesture()
            .onBegin(() => {
              runOnJS(handleJump)(true);
            })
            .onFinalize(() => {
              runOnJS(handleJump)(false);
            })}
        >
          <Animated.View
            style={{
              position: 'absolute',
              bottom: 30,
              right: 30,
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: 'rgba(255, 255, 255, 0.3)',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 10,
            }}
          >
            <Text style={{ color: 'white', fontSize: 18 }}>JUMP</Text>
          </Animated.View>
        </GestureDetector>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // Inventory HUD styles
  inventoryContainer: {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    marginLeft: -160, // Half of the total width (4 cells * 80px)
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  inventoryCell: {
    width: 70,
    height: 70,
    margin: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  selectedInventoryCell: {
    borderColor: 'rgba(255, 255, 255, 0.8)',
    borderWidth: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  blockPreview: {
    width: 40,
    height: 40,
    borderRadius: 4,
  },
  blockCount: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },

  // Touch indicator style
  touchIndicator: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderWidth: 2,
    borderColor: 'white',
    marginLeft: -15,
    marginTop: -15,
    pointerEvents: 'none',
  },
});
