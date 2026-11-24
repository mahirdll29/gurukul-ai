export type StorageCostInput={logicalBytes:number;physicalBytes:number;coldEligibleBytes:number;hotUsdPerGbMonth:number;coldUsdPerGbMonth:number};
export function calculateStorageCost(input:StorageCostInput){
  const gb=1024**3,logical=Math.max(0,input.logicalBytes),physical=Math.max(0,input.physicalBytes),cold=Math.min(physical,Math.max(0,input.coldEligibleBytes)),hot=physical-cold;
  const naiveMonthlyUsd=logical/gb*input.hotUsdPerGbMonth;
  const dedupMonthlyUsd=physical/gb*input.hotUsdPerGbMonth;
  const tieredMonthlyUsd=hot/gb*input.hotUsdPerGbMonth+cold/gb*input.coldUsdPerGbMonth;
  return {naiveMonthlyUsd,dedupMonthlyUsd,tieredMonthlyUsd,hotBytes:hot,coldEligibleBytes:cold,savingsPercent:naiveMonthlyUsd?100*(naiveMonthlyUsd-tieredMonthlyUsd)/naiveMonthlyUsd:0,simulated:true};
}
