import { heroProfile as sourceHeroProfile, milestones as sourceMilestones } from '../../cvData.js';

export function createCareerRuntime() {
  return {
    heroProfile: {
      ...sourceHeroProfile,
      contact: { ...sourceHeroProfile.contact },
      links: sourceHeroProfile.links.map((link) => ({ ...link })),
    },
    milestones: sourceMilestones.map((item, index) => ({
      ...item,
      index,
      unlocked: false,
    })),
  };
}
