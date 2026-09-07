export interface ReliefSummary {
  label: string;
  value: string;
  caption: string;
  emphasis?: boolean;
}

export interface ReliefInventoryItem {
  inventory_id?: string;
  id: string;
  name: string;
  unit: string;
  quantity: number;
}

export interface ReliefRecommendation {
  recommendation_id?: string;
  id: string;
  barangay_name?: string;
  barangay: string;
  selectedPlanId?: ReliefPlanId;
  selectedPlanName?: string;
  objectiveValue?: number | null;
  priorityScore?: number | null;
  waterLevelM?: number | null;
  riskLevel: string;
  affectedFamilies: number;
  familyFoodPacks: number;
  medicineKits: number;
  reliefForIndividual: number;
  hasSensorReading: boolean;
  recommendedItems: string;
  analysisReason: string;
  report: string;
  fuzzyExplanation?: {
    waterLevelM: number | null;
    confidence: number | null;
    riskLabel: string;
    memberships?: Record<string, number>;
  };
  ahpBreakdown?: AhpBreakdown;
  ahpVulnerabilityScore?: number | null;
  demandCeiling?: Record<string, number>;
  constraintsSatisfied?: boolean;
  availableSupply?: ReliefAvailableSupply;
  reasoningSteps?: string[];
}

export interface ReliefAllocationHistory {
  recommendation_id?: string;
  id: string;
  barangay_name?: string;
  date: string;
  time: string;
  barangay: string;
  familyFoodPacks: number;
  medicineKits: number;
  reliefForIndividual: number;
}

export type ReliefPlanId = "severity_first" | "vulnerability_first" | "balanced";

export interface ReliefAvailableSupply {
  family_food_packs?: number;
  individual_relief_goods?: number;
  emergency_kits?: number;
}

export interface AhpBreakdown {
  counts?: Record<string, number>;
  weights?: Record<string, number>;
  contributions?: Record<string, number>;
  total_vulnerability_score?: number;
}

export interface ReliefPlanAllocation {
  recommendation_id?: string;
  barangay_id?: string | number;
  barangay_name?: string;
  barangay?: string;
  risk_level?: string;
  priority_score?: number;
  base_priority_score?: number;
  water_level_m?: number;
  affected_families?: number;
  recommended_family_food_packs?: number;
  recommended_medicine_kits?: number;
  recommended_emergency_kits?: number;
  recommended_relief_goods_individual?: number;
  recommended_individual_relief_goods?: number;
  demand_ceiling?: Record<string, number>;
  constraints_satisfied?: boolean;
  analysis_reason?: string;
  ahp_breakdown?: AhpBreakdown;
  fuzzy_explanation?: {
    water_level_m?: number;
    confidence?: number;
    risk_label?: string;
    risk_level?: string;
    memberships?: Record<string, number>;
  };
  reasoning_steps?: string[];
}

export interface ReliefAllocationPlan {
  plan_id: ReliefPlanId;
  plan_name: string;
  objective_value?: number;
  available_supply?: ReliefAvailableSupply;
  solver_status?: Record<string, string>;
  constraints?: Record<string, string>;
  allocations: ReliefPlanAllocation[];
  reasoning_steps?: string[];
}

export interface ReliefGenerationResponse {
  success?: boolean;
  data?: Record<string, unknown>[];
  plans?: ReliefAllocationPlan[];
}

export interface EmergencyWorkflowResponse {
  success?: boolean;
  batch_id?: string;
  plan_id?: ReliefPlanId | string;
  plan_name?: string;
  status?: string;
  items?: Record<string, unknown>[];
  data?: Record<string, unknown>[];
  duplicate?: boolean;
  qr_token?: string;
}

export interface EmergencyAllocationItem {
  item_id: string;
  batch_id?: string;
  recommendation_id?: string | null;
  barangay_id: number;
  barangay_name: string;
  family_food_packs: number;
  individual_relief_goods: number;
  emergency_kits: number;
  barangay_status: string;
  created_at?: string | null;
}

export interface CurrentEmergencyAllocation {
  batch_id: string;
  plan_id: ReliefPlanId | string;
  plan_name: string;
  status: string;
  created_at?: string | null;
  accepted_at?: string | null;
  items: EmergencyAllocationItem[];
}

export interface BarangayNotificationResponse {
  success?: boolean;
  data?: CurrentEmergencyAllocation | null;
  notifications_created?: number;
  already_notified?: boolean;
}
