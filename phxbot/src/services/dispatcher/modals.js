import { modal, input } from "../../ui/ui.js";

export function setRoleModal(which) {
  const map = {
    admin: "admin_role_id",
    supervisor: "supervisor_role_id",
    config: "config_role_id",
    pk: "pk_role_id",
    ban: "ban_role_id",
  };
  const key = map[which];
  return modal(`famenu:setrole_modal:${which}`, "Set Role ID", [
    input("role_id", "Role ID ", undefined, true, "Ex: 123..."),
  ]);
}

export function setChannelModal(which) {
  return modal(`famenu:setchannel_modal:${which}`, "Set Channel ID", [
    input("channel_id", "Channel ID ", undefined, true, "Ex: 123..."),
  ]);
}

export function cooldownAddModal() {
  return modal("famenu:cooldown_add_modal", "Adaugă cooldown", [
    input("user", "User ID", undefined, true, "Ex: 123..."),
    input("kind", "Tip (PK/BAN)", undefined, true, "PK sau BAN"),
    input("duration", "Durată (ex: 30s, 10m, 1d, 1y)", undefined, true, "30s / 10m / 1d"),
  ]);
}

export function cooldownRemoveModal() {
  return modal("famenu:cooldown_remove_modal", "Șterge cooldown", [
    input("user", "User ID", undefined, true, "Ex: 123..."),
    input("kind", "Tip (PK/BAN)", undefined, true, "PK sau BAN"),
  ]);
}

export function deleteOrgModal() {
  return modal("famenu:deleteorg_modal", "Delete organizatie", [
    input("org_id", "Org ID", undefined, true, "ID din lista Organizații"),
    input("reason", "Motiv (opțional)", undefined, false, "Ex: desființare"),
  ]);
}

export function addMembersModal(orgId) {
  return modal(`org:${orgId}:add_modal`, "Add membri", [
    input("users", "User ID-uri (multi-line)", 2, true, "Ex:\n123..."),
  ]);
}

export function removeMembersModal(orgId, pk) {
  return modal(`org:${orgId}:${pk ? "remove_pk" : "remove"}_modal`, pk ? "Remove (PK)" : "Remove", [
    input("users", "User ID-uri (multi-line)", 2, true, "Ex:\n123..."),
  ]);
}

export function searchModal(orgId) {
  return modal(`org:${orgId}:search_modal`, "Search player", [
    input("user", "User ID", undefined, true, "Ex: 123..."),
  ]);
}

export function reconcileOrgModal() {
  return modal("famenu:reconcile_org_modal", "Reconcile organizație", [
    input("org_id", "Org ID", undefined, true, "ID din lista Organizații"),
  ]);
}

export function setRankModal(orgId) {
  return modal(`org:${orgId}:setrank_modal`, "Setează rank", [
    input("user", "User ID", undefined, true, "Ex: 123..."),
    input("rank", "Rank (LEADER/COLEADER/MEMBER)", undefined, true, "Ex: COLEADER"),
  ]);
}
