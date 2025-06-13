import { useState, useEffect } from 'react';
import { Policy, PolicyStats, RenewalAlert } from '../types/policy';
import { loadFromLocalStorage, saveToLocalStorage } from '../utils/localStorage';
import { calculateAge, getDaysUntilRenewal, getAgeGroup, isRenewalDueSoon } from '../utils/dateUtils';
import { sendPolicyAddedSMS, initializeSMSScheduler } from '../utils/smsNotifications';

export const usePolicies = () => {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadedPolicies = loadFromLocalStorage();
    
    // Migrate existing policies to include renewalFrequency if missing
    const migratedPolicies = loadedPolicies.map(policy => ({
      ...policy,
      renewalFrequency: policy.renewalFrequency || 'yearly' as const
    }));
    
    if (migratedPolicies.length !== loadedPolicies.length || 
        migratedPolicies.some((p, i) => p.renewalFrequency !== loadedPolicies[i]?.renewalFrequency)) {
      saveToLocalStorage(migratedPolicies);
    }
    
    setPolicies(migratedPolicies);
    setLoading(false);
    
    // Initialize SMS scheduler for birthday and renewal reminders
    if (migratedPolicies.length > 0) {
      initializeSMSScheduler(migratedPolicies);
    }
  }, []);

  const savePolicies = (newPolicies: Policy[]) => {
    setPolicies(newPolicies);
    saveToLocalStorage(newPolicies);
  };

  const addPolicy = async (policy: Omit<Policy, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newPolicy: Policy = {
      ...policy,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    const updatedPolicies = [...policies, newPolicy];
    savePolicies(updatedPolicies);
    
    // Send welcome SMS
    try {
      const smsResult = await sendPolicyAddedSMS(newPolicy);
      if (smsResult) {
        console.log(`Welcome SMS sent to ${newPolicy.policyholderName}`);
      }
    } catch (error) {
      console.error('Failed to send welcome SMS:', error);
    }
  };

  const updatePolicy = (id: string, updates: Partial<Policy>) => {
    const updatedPolicies = policies.map(policy =>
      policy.id === id ? { ...policy, ...updates, updatedAt: new Date().toISOString() } : policy
    );
    savePolicies(updatedPolicies);
  };

  const deletePolicy = (id: string) => {
    const filteredPolicies = policies.filter(policy => policy.id !== id);
    savePolicies(filteredPolicies);
  };

  const getStats = (): PolicyStats => {
    const totalPolicies = policies.length;
    const totalPremium = policies.reduce((sum, policy) => sum + policy.policyPremiumAmount, 0);
    const avgPremium = totalPolicies > 0 ? totalPremium / totalPolicies : 0;

    const categoryDistribution = policies.reduce((acc, policy) => {
      acc[policy.insuranceCategory] = (acc[policy.insuranceCategory] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const ageGroupDistribution = policies.reduce((acc, policy) => {
      const age = calculateAge(policy.dateOfBirth);
      const ageGroup = getAgeGroup(age);
      acc[ageGroup] = (acc[ageGroup] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const monthlyRenewals = policies.reduce((acc, policy) => {
      const month = new Date(policy.policyRenewalDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      acc[month] = (acc[month] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const renewalFrequencyDistribution = policies.reduce((acc, policy) => {
      const frequency = policy.renewalFrequency || 'yearly';
      acc[frequency] = (acc[frequency] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Calculate monthly and yearly premium totals
    const monthlyPremiumTotal = policies.reduce((sum, policy) => {
      if (policy.renewalFrequency === 'monthly') {
        return sum + policy.policyPremiumAmount;
      } else {
        return sum + (policy.policyPremiumAmount / 12);
      }
    }, 0);

    const yearlyPremiumTotal = policies.reduce((sum, policy) => {
      if (policy.renewalFrequency === 'yearly') {
        return sum + policy.policyPremiumAmount;
      } else {
        return sum + (policy.policyPremiumAmount * 12);
      }
    }, 0);

    return {
      totalPolicies,
      totalPremium,
      avgPremium,
      categoryDistribution,
      ageGroupDistribution,
      monthlyRenewals,
      renewalFrequencyDistribution,
      monthlyPremiumTotal,
      yearlyPremiumTotal
    };
  };

  const getRenewalAlerts = (): RenewalAlert[] => {
    return policies
      .filter(policy => isRenewalDueSoon(policy.policyRenewalDate))
      .map(policy => ({
        policy,
        daysUntilRenewal: getDaysUntilRenewal(policy.policyRenewalDate)
      }))
      .sort((a, b) => a.daysUntilRenewal - b.daysUntilRenewal);
  };

  return {
    policies,
    loading,
    addPolicy,
    updatePolicy,
    deletePolicy,
    getStats,
    getRenewalAlerts
  };
};