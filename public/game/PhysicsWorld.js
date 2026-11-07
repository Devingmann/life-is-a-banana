import * as CANNON from 'cannon-es';

/**
 * PhysicsWorld
 * ------------
 * cannon-es integration: gravity, contact materials (grippy road vs.
 * buttery banana), static hitboxes for obstacles / void-gap edges /
 * peel-trap triggers, downward raycasts for grounded checks, and a
 * collision-event dispatcher for the player body.
 */

export const GROUP_WORLD = 1;
export const GROUP_PLAYER = 2;

const FIXED_STEP = 1 / 60;

export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -32, 0), // arcade-gravity: snappy falls
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = false;

    // Contact materials
    this.groundMaterial = new CANNON.Material('ground');
    this.playerMaterial = new CANNON.Material('player');
    this.obstacleMaterial = new CANNON.Material('obstacle');

    // The road is deliberately slick — a banana rolls best on drama.
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.playerMaterial, this.groundMaterial,
      { friction: 0.02, restitution: 0.05, contactEquationStiffness: 1e8, contactEquationRelaxation: 3 }
    ));
    // Obstacles bounce the banana away with comedic energy.
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.playerMaterial, this.obstacleMaterial,
      { friction: 0.1, restitution: 0.55 }
    ));
    this.world.defaultContactMaterial.friction = 0.05;

    this._collideHandlers = [];
    this._rayResult = new CANNON.RaycastResult();
  }

  /**
   * Register the player body: sets collision group, attaches the single
   * 'collide' event listener that fans out to registered handlers.
   */
  registerPlayer(body) {
    body.collisionFilterGroup = GROUP_PLAYER;
    body.collisionFilterMask = GROUP_WORLD;
    body.addEventListener('collide', (event) => {
      const other = event.body;
      const kind = other.userData ? other.userData.kind : null;
      if (!kind) return;
      for (const h of this._collideHandlers) {
        try { h(kind, other, event); } catch (e) { console.error('[PhysicsWorld] handler error', e); }
      }
    });
  }

  onPlayerCollide(handler) { this._collideHandlers.push(handler); }

  /**
   * Static axis-aligned box hitbox. `kind` + userData reach the collision
   * dispatcher. Returns the body.
   */
  addStaticBox(halfExtents, position, { kind = 'ground', material = this.groundMaterial, userData = null, group = GROUP_WORLD } = {}) {
    const shape = new CANNON.Box(new CANNON.Vec3(halfExtents.x, halfExtents.y, halfExtents.z));
    const body = new CANNON.Body({
      mass: 0,
      material,
      shape,
      collisionFilterGroup: group,
    });
    body.position.set(position.x, position.y, position.z);
    body.userData = { kind, ...userData };
    this.world.addBody(body);
    return body;
  }

  /** Static cylinder hitbox (Y-aligned) — for the Blender of Fate. */
  addStaticCylinder(radius, height, position, { kind = 'obstacle', material = this.obstacleMaterial, userData = null } = {}) {
    const shape = new CANNON.Cylinder(radius, radius, height, 12);
    const body = new CANNON.Body({ mass: 0, material, shape, collisionFilterGroup: GROUP_WORLD });
    body.position.set(position.x, position.y, position.z);
    body.userData = { kind, ...userData };
    this.world.addBody(body);
    return body;
  }

  removeBody(body) {
    if (!body) return;
    const i = this.world.bodies.indexOf(body);
    if (i !== -1) this.world.removeBody(body);
  }

  /** Downward grounded raycast (hits GROUP_WORLD only). */
  raycastDown(from, length) {
    const to = new CANNON.Vec3(from.x, from.y - length, from.z);
    this._rayResult.reset();
    this.world.raycastClosest(from, to, {
      collisionFilterMask: GROUP_WORLD,
      skipBackfaces: true,
    }, this._rayResult);
    return this._rayResult.hasHit ? this._rayResult : null;
  }

  step(dt) {
    this.world.step(FIXED_STEP, dt, 4);
  }

  clear() {
    // Remove every non-player body (world is rebuilt per chunk recycle)
    for (let i = this.world.bodies.length - 1; i >= 0; i--) {
      const b = this.world.bodies[i];
      if (b.collisionFilterGroup !== GROUP_PLAYER) this.world.removeBody(b);
    }
  }
}
