import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { LaundryCycle, ThemeShift } from '../types/laundry';
import { playMechanicalClick } from '../utils/laundrySfx';

export type VoxelOperatorState = 'idle' | 'washing' | 'spinning' | 'drying';

interface CreatorSpotlightProps {
  operatorState: VoxelOperatorState;
  cycle: LaundryCycle;
  shift: ThemeShift;
}

const CYCLE_HEX: Record<LaundryCycle, number> = {
  wash: 0x00e5ff,
  spin: 0xff5416,
  both: 0xffe600,
};

const STATE_LABEL: Record<VoxelOperatorState, string> = {
  idle: 'SHAKING DETERGENT',
  washing: 'SCRUBBING LOADS',
  spinning: 'HIGH-SPEED SPIN CHEER',
  drying: 'WAVING CLEAN TOWEL',
};

/**
 * Compact 3D Voxel Creator Spotlight in the top-right header (Coolaudio style).
 * Animates temp/lee-voxel.glb (served from /models/lee-voxel.glb) with
 * state-reactive laundry actions and a Neo-Brutalist creator popover card.
 */
export const CreatorSpotlight: React.FC<CreatorSpotlightProps> = ({
  operatorState,
  cycle,
  shift,
}) => {
  const [open, setOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stateRef = useRef<VoxelOperatorState>(operatorState);
  const cycleRef = useRef<LaundryCycle>(cycle);

  useEffect(() => {
    stateRef.current = operatorState;
  }, [operatorState]);

  useEffect(() => {
    cycleRef.current = cycle;
  }, [cycle]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let rafId = 0;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
    } catch {
      setLoadFailed(true);
      return;
    }

    const size = 44;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    camera.position.set(0.55, 1.15, 2.75);
    camera.lookAt(0, 0.92, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.35);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
    keyLight.position.set(2.5, 4, 3);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x00e5ff, 0.45);
    rimLight.position.set(-2, 1.5, -1.5);
    scene.add(rimLight);

    // Procedural Voxel Laundry Props
    // 1. Detergent Bottle (attached to armR during idle)
    const detergentGroup = new THREE.Group();
    const bottleMat = new THREE.MeshStandardMaterial({
      color: CYCLE_HEX[cycleRef.current],
      roughness: 0.4,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    const bottleBody = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.2, 1.6), bottleMat);
    const bottleCap = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), darkMat);
    bottleCap.position.set(0, 2.0, 0);
    detergentGroup.add(bottleBody, bottleCap);
    detergentGroup.position.set(0, -7.2, 1.6);

    // 2. Clean Towel (attached to armR during drying)
    const towelGroup = new THREE.Group();
    const towelMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, roughness: 0.5 });
    const towelSheet = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.2, 3.6), towelMat);
    const towelStripe = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 3.65), stripeMat);
    towelStripe.position.set(0, -1.2, 0);
    towelGroup.add(towelSheet, towelStripe);
    towelGroup.position.set(0.4, -7.8, 1.2);
    towelGroup.visible = false;

    // 3. Mini Wash Tub & Soap Bubbles (in front of character during washing)
    const tubGroup = new THREE.Group();
    const tubWallMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, roughness: 0.45 });
    const sudsMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const tubBase = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.34, 0.45), tubWallMat);
    const tubFoam = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.12, 0.36), sudsMat);
    tubFoam.position.set(0, 0.14, 0);
    tubGroup.add(tubBase, tubFoam);
    tubGroup.position.set(0, 0.56, 0.42);
    tubGroup.visible = false;

    const bubbles: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), sudsMat);
      b.position.set((i - 1.5) * 0.14, 0.25, (i % 2 === 0 ? 1 : -1) * 0.06);
      tubGroup.add(b);
      bubbles.push(b);
    }
    scene.add(tubGroup);

    let rootNode: THREE.Object3D | null = null;
    let headNode: THREE.Object3D | null = null;
    let torsoNode: THREE.Object3D | null = null;
    let armLNode: THREE.Object3D | null = null;
    let armRNode: THREE.Object3D | null = null;
    let legLNode: THREE.Object3D | null = null;
    let legRNode: THREE.Object3D | null = null;
    let baseRootY = 0;

    const loader = new GLTFLoader();
    loader.load(
      '/models/lee-voxel.glb',
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        scene.add(model);

        rootNode = model.getObjectByName('LeeVoxel') ?? model;
        headNode = model.getObjectByName('head') ?? null;
        torsoNode = model.getObjectByName('torso') ?? null;
        armLNode = model.getObjectByName('armL') ?? null;
        armRNode = model.getObjectByName('armR') ?? null;
        legLNode = model.getObjectByName('legL') ?? null;
        legRNode = model.getObjectByName('legR') ?? null;
        baseRootY = rootNode.position.y;

        if (armRNode) {
          armRNode.add(detergentGroup);
          armRNode.add(towelGroup);
        }
      },
      undefined,
      () => {
        if (!disposed) setLoadFailed(true);
      }
    );

    const clock = new THREE.Clock();

    const animate = () => {
      if (disposed) return;
      rafId = requestAnimationFrame(animate);

      const t = clock.getElapsedTime();
      const opState = stateRef.current;
      bottleMat.color.setHex(CYCLE_HEX[cycleRef.current]);

      if (rootNode) {
        detergentGroup.visible = opState === 'idle';
        towelGroup.visible = opState === 'drying';
        tubGroup.visible = opState === 'washing';

        // Reset defaults
        rootNode.position.y = baseRootY;
        rootNode.rotation.set(0, 0, 0);
        if (torsoNode) torsoNode.rotation.set(0, 0, 0);
        if (headNode) headNode.rotation.set(0, 0, 0);
        if (armLNode) armLNode.rotation.set(0, 0, 0);
        if (armRNode) armRNode.rotation.set(0, 0, 0);
        if (legLNode) legLNode.rotation.set(0, 0, 0);
        if (legRNode) legRNode.rotation.set(0, 0, 0);

        if (opState === 'idle') {
          // Holding and gently shaking detergent bottle
          rootNode.position.y = baseRootY + Math.abs(Math.sin(t * 2.2)) * 0.025;
          if (armRNode) {
            armRNode.rotation.x = -0.82 + Math.sin(t * 5.2) * 0.24;
            armRNode.rotation.z = -0.15;
          }
          if (armLNode) {
            armLNode.rotation.x = Math.sin(t * 2.0) * 0.14;
            armLNode.rotation.z = 0.12;
          }
          if (headNode) {
            headNode.rotation.y = Math.sin(t * 1.3) * 0.2;
            headNode.rotation.z = Math.sin(t * 2.1) * 0.05;
          }
        } else if (opState === 'washing') {
          // Scrubbing clothes over soap suds tub
          if (torsoNode) torsoNode.rotation.x = 0.2;
          if (headNode) {
            headNode.rotation.x = 0.22 + Math.sin(t * 6) * 0.06;
            headNode.rotation.y = Math.sin(t * 3) * 0.12;
          }
          if (armLNode) {
            armLNode.rotation.x = -0.95 + Math.sin(t * 11) * 0.42;
            armLNode.rotation.z = -0.12;
          }
          if (armRNode) {
            armRNode.rotation.x = -0.95 - Math.sin(t * 11) * 0.42;
            armRNode.rotation.z = 0.12;
          }
          bubbles.forEach((b, idx) => {
            const cycleT = (t * 1.8 + idx * 0.35) % 1;
            b.position.y = 0.22 + cycleT * 0.34;
            b.scale.setScalar(1 - cycleT * 0.4);
          });
        } else if (opState === 'spinning') {
          // High-speed spin cheer!
          rootNode.position.y = baseRootY + Math.abs(Math.sin(t * 14)) * 0.07;
          rootNode.rotation.y = Math.sin(t * 7) * 0.38;
          if (armLNode) {
            armLNode.rotation.x = -2.35 + Math.sin(t * 14) * 0.35;
            armLNode.rotation.z = 0.35;
          }
          if (armRNode) {
            armRNode.rotation.x = -2.35 - Math.sin(t * 14) * 0.35;
            armRNode.rotation.z = -0.35;
          }
          if (legLNode) legLNode.rotation.x = Math.sin(t * 14) * 0.32;
          if (legRNode) legRNode.rotation.x = -Math.sin(t * 14) * 0.32;
          if (headNode) headNode.rotation.z = Math.sin(t * 7) * 0.14;
        } else if (opState === 'drying') {
          // Waving clean fresh towel happily
          rootNode.position.y = baseRootY + Math.abs(Math.sin(t * 2.6)) * 0.03;
          if (armRNode) {
            armRNode.rotation.x = -1.95;
            armRNode.rotation.z = -0.32 + Math.sin(t * 5.2) * 0.34;
          }
          if (armLNode) {
            armLNode.rotation.x = -0.25;
            armLNode.rotation.z = 0.24 + Math.sin(t * 2.6) * 0.08;
          }
          if (headNode) {
            headNode.rotation.y = Math.sin(t * 2.1) * 0.16;
            headNode.rotation.z = Math.sin(t * 5.2) * 0.06;
          }
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      bottleMat.dispose();
      darkMat.dispose();
      towelMat.dispose();
      stripeMat.dispose();
      tubWallMat.dispose();
      sudsMat.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          playMechanicalClick(760);
          setOpen((v) => !v);
        }}
        aria-label="About the creator"
        aria-expanded={open}
        title="About the creator — Lee Khan"
        className="neo-btn w-[44px] h-[44px] p-0 overflow-hidden flex items-center justify-center relative shrink-0"
        style={{
          backgroundColor: shift === 'night' ? '#0F172A' : '#ECE6DC',
        }}
      >
        {loadFailed ? (
          <span className="font-mono text-[10px] font-bold text-adaptive">LK</span>
        ) : (
          <canvas
            ref={canvasRef}
            width={44}
            height={44}
            aria-label="Lee Khan, animated voxel laundry operator"
            className="w-[44px] h-[44px] block pointer-events-none"
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Creator Spotlight"
          className="neo-card absolute right-0 top-[calc(100%+10px)] z-50 w-[268px] p-3.5"
          style={{
            backgroundColor: 'var(--ui-card)',
            color: 'var(--ui-text)',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="font-extrabold text-sm text-adaptive">Lee Khan</span>
            <span
              className="font-mono text-[10px] font-bold px-1.5 py-0.5 uppercase"
              style={{
                backgroundColor: '#FF5416',
                color: '#111111',
                border: '2px solid var(--ink)',
              }}
            >
              CREATOR
            </span>
          </div>

          <p className="text-xs leading-relaxed text-adaptive opacity-90">
            “No regrets, just lessons in my flow.”
          </p>

          <div
            className="mt-2.5 pt-2 border-t-2 font-mono text-[10px] font-bold uppercase flex items-center justify-between"
            style={{ borderColor: 'var(--ink)' }}
          >
            <span className="opacity-75 text-adaptive">OPERATOR:</span>
            <span
              className="px-1.5 py-0.5 text-on-accent"
              style={{ backgroundColor: 'var(--active-accent)' }}
            >
              {STATE_LABEL[operatorState]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
