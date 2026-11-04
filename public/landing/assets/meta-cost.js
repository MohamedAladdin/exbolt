/* ==========================================================================
   /meta-cost — calculator
   Rates: Meta WhatsApp Business Platform rate card, effective 2026-10-01
   (USD list rates + volume tiers for utility / authentication).
   Model: per-message, charged on delivery, priced by recipient market.
   ========================================================================== */
(function () {
  "use strict";

  var MARKETS = {"Argentina":{"ar":"الأرجنتين","mkt":0.0618,"util":0.026,"auth":0.026,"authIntl":null,"service":0.026,"tiers":{"util":[[0.0,100000.0,0.026,"List rate"],[100001.0,1000000.0,0.0247,"Tier rate"],[1000001.0,4500000.0,0.0234,"Tier rate"],[4500001.0,15000000.0,0.0221,"Tier rate"],[15000001.0,30000000.0,0.0208,"Tier rate"],[30000001.0,null,0.0195,"Tier rate"]],"auth":[[0.0,120000.0,0.026,"List rate"],[120001.0,400000.0,0.0247,"Tier rate"],[400001.0,1000000.0,0.0234,"Tier rate"],[1000001.0,5000000.0,0.0221,"Tier rate"],[5000001.0,10000000.0,0.0208,"Tier rate"],[10000001.0,null,0.0195,"Tier rate"]]}},"Bangladesh":{"ar":"بنجلاديش","mkt":0.0732,"util":0.0037,"auth":0.0037,"authIntl":0.096,"service":0.0037,"tiers":{"util":[[0.0,150000.0,0.0037,"List rate"],[150001.0,1000000.0,0.0035,"Tier rate"],[1000001.0,4000000.0,0.0033,"Tier rate"],[4000001.0,25000000.0,0.0031,"Tier rate"],[25000001.0,50000000.0,0.003,"Tier rate"],[50000001.0,null,0.0028,"Tier rate"]],"auth":[[0.0,100000.0,0.0037,"List rate"],[100001.0,300000.0,0.0035,"Tier rate"],[300001.0,1000000.0,0.0033,"Tier rate"],[1000001.0,10000000.0,0.0031,"Tier rate"],[10000001.0,20000000.0,0.003,"Tier rate"],[20000001.0,null,0.0028,"Tier rate"]],"authIntl":[[0.0,100000.0,0.096,"List rate"],[100001.0,300000.0,0.0912,"Tier rate"],[300001.0,1000000.0,0.0864,"Tier rate"],[1000001.0,10000000.0,0.0816,"Tier rate"],[10000001.0,20000000.0,0.0768,"Tier rate"],[20000001.0,null,0.072,"Tier rate"]]}},"Brazil":{"ar":"البرازيل","mkt":0.0625,"util":0.0068,"auth":0.0068,"authIntl":null,"service":0.0068,"tiers":{"util":[[0.0,250000.0,0.0068,"List rate"],[250001.0,2000000.0,0.0065,"Tier rate"],[2000001.0,17000000.0,0.0061,"Tier rate"],[17000001.0,35000000.0,0.0058,"Tier rate"],[35000001.0,70000000.0,0.0054,"Tier rate"],[70000001.0,null,0.0051,"Tier rate"]],"auth":[[0.0,500000.0,0.0068,"List rate"],[500001.0,3000000.0,0.0065,"Tier rate"],[3000001.0,5250000.0,0.0061,"Tier rate"],[5250001.0,10000000.0,0.0058,"Tier rate"],[10000001.0,20000000.0,0.0054,"Tier rate"],[20000001.0,null,0.0051,"Tier rate"]]}},"Chile":{"ar":"تشيلي","mkt":0.0889,"util":0.02,"auth":0.02,"authIntl":null,"service":0.02,"tiers":{"util":[[0.0,100000.0,0.02,"List rate"],[100001.0,1000000.0,0.019,"Tier rate"],[1000001.0,4500000.0,0.018,"Tier rate"],[4500001.0,15000000.0,0.017,"Tier rate"],[15000001.0,30000000.0,0.016,"Tier rate"],[30000001.0,null,0.015,"Tier rate"]],"auth":[[0.0,120000.0,0.02,"List rate"],[120001.0,400000.0,0.019,"Tier rate"],[400001.0,1000000.0,0.018,"Tier rate"],[1000001.0,5000000.0,0.017,"Tier rate"],[5000001.0,10000000.0,0.016,"Tier rate"],[10000001.0,null,0.015,"Tier rate"]]}},"Colombia":{"ar":"كولومبيا","mkt":0.0125,"util":0.0008,"auth":0.0008,"authIntl":null,"service":0.0008,"tiers":{"util":[[0.0,100000.0,0.0008,"List rate"],[100001.0,1000000.0,0.0008,"Tier rate"],[1000001.0,4500000.0,0.0007,"Tier rate"],[4500001.0,15000000.0,0.0007,"Tier rate"],[15000001.0,30000000.0,0.0006,"Tier rate"],[30000001.0,null,0.0006,"Tier rate"]],"auth":[[0.0,120000.0,0.0008,"List rate"],[120001.0,400000.0,0.0008,"Tier rate"],[400001.0,1000000.0,0.0007,"Tier rate"],[1000001.0,5000000.0,0.0007,"Tier rate"],[5000001.0,10000000.0,0.0006,"Tier rate"],[10000001.0,null,0.0006,"Tier rate"]]}},"Egypt":{"ar":"مصر","mkt":0.0644,"util":0.0036,"auth":0.0036,"authIntl":0.065,"service":0.0036,"tiers":{"util":[[0.0,100000.0,0.0036,"List rate"],[100001.0,1000000.0,0.0034,"Tier rate"],[1000001.0,4500000.0,0.0032,"Tier rate"],[4500001.0,40000000.0,0.0031,"Tier rate"],[40000001.0,80000000.0,0.0029,"Tier rate"],[80000001.0,null,0.0027,"Tier rate"]],"auth":[[0.0,300000.0,0.0036,"List rate"],[300001.0,2000000.0,0.0034,"Tier rate"],[2000001.0,10000000.0,0.0032,"Tier rate"],[10000001.0,20000000.0,0.0031,"Tier rate"],[20000001.0,40000000.0,0.0029,"Tier rate"],[40000001.0,null,0.0027,"Tier rate"]],"authIntl":[[0.0,300000.0,0.065,"List rate"],[300001.0,2000000.0,0.0618,"Tier rate"],[2000001.0,10000000.0,0.0585,"Tier rate"],[10000001.0,20000000.0,0.0553,"Tier rate"],[20000001.0,40000000.0,0.052,"Tier rate"],[40000001.0,null,0.0488,"Tier rate"]]}},"France":{"ar":"فرنسا","mkt":0.0859,"util":0.03,"auth":0.03,"authIntl":null,"service":0.03,"tiers":{"util":[[0.0,100000.0,0.03,"List rate"],[100001.0,1000000.0,0.0285,"Tier rate"],[1000001.0,4500000.0,0.027,"Tier rate"],[4500001.0,40000000.0,0.0255,"Tier rate"],[40000001.0,80000000.0,0.024,"Tier rate"],[80000001.0,null,0.0225,"Tier rate"]],"auth":[[0.0,300000.0,0.03,"List rate"],[300001.0,2000000.0,0.0285,"Tier rate"],[2000001.0,10000000.0,0.027,"Tier rate"],[10000001.0,20000000.0,0.0255,"Tier rate"],[20000001.0,40000000.0,0.024,"Tier rate"],[40000001.0,null,0.0225,"Tier rate"]]}},"Germany":{"ar":"ألمانيا","mkt":0.1365,"util":0.055,"auth":0.055,"authIntl":null,"service":0.055,"tiers":{"util":[[0.0,100000.0,0.055,"List rate"],[100001.0,1000000.0,0.0523,"Tier rate"],[1000001.0,4500000.0,0.0495,"Tier rate"],[4500001.0,40000000.0,0.0468,"Tier rate"],[40000001.0,80000000.0,0.044,"Tier rate"],[80000001.0,null,0.0413,"Tier rate"]],"auth":[[0.0,300000.0,0.055,"List rate"],[300001.0,2000000.0,0.0523,"Tier rate"],[2000001.0,10000000.0,0.0495,"Tier rate"],[10000001.0,20000000.0,0.0468,"Tier rate"],[20000001.0,40000000.0,0.044,"Tier rate"],[40000001.0,null,0.0413,"Tier rate"]]}},"Hong Kong":{"ar":"هونج كونج","mkt":0.0732,"util":0.026,"auth":0.026,"authIntl":null,"service":0.026,"tiers":{"util":[[0.0,150000.0,0.026,"List rate"],[150001.0,1000000.0,0.0247,"Tier rate"],[1000001.0,4000000.0,0.0234,"Tier rate"],[4000001.0,25000000.0,0.0221,"Tier rate"],[25000001.0,50000000.0,0.0208,"Tier rate"],[50000001.0,null,0.0195,"Tier rate"]],"auth":[[0.0,100000.0,0.026,"List rate"],[100001.0,300000.0,0.0247,"Tier rate"],[300001.0,1000000.0,0.0234,"Tier rate"],[1000001.0,10000000.0,0.0221,"Tier rate"],[10000001.0,20000000.0,0.0208,"Tier rate"],[20000001.0,null,0.0195,"Tier rate"]]}},"Hungary":{"ar":"المجر","mkt":0.086,"util":0.035,"auth":0.035,"authIntl":null,"service":0.035,"tiers":{"util":[[0.0,100000.0,0.035,"List rate"],[100001.0,1000000.0,0.0333,"Tier rate"],[1000001.0,4500000.0,0.0315,"Tier rate"],[4500001.0,40000000.0,0.0298,"Tier rate"],[40000001.0,80000000.0,0.028,"Tier rate"],[80000001.0,null,0.0263,"Tier rate"]],"auth":[[0.0,300000.0,0.035,"List rate"],[300001.0,2000000.0,0.0333,"Tier rate"],[2000001.0,10000000.0,0.0315,"Tier rate"],[10000001.0,20000000.0,0.0298,"Tier rate"],[20000001.0,40000000.0,0.028,"Tier rate"],[40000001.0,null,0.0263,"Tier rate"]]}},"India":{"ar":"الهند","mkt":0.0118,"util":0.0014,"auth":0.0014,"authIntl":0.0304,"service":0.0014,"tiers":{"util":[[0.0,25000000.0,0.0014,"List rate"],[25000001.0,50000000.0,0.0013,"Tier rate"],[50000001.0,100000000.0,0.0012,"Tier rate"],[100000001.0,200000000.0,0.0011,"Tier rate"],[200000001.0,300000000.0,0.0011,"Tier rate"],[300000001.0,null,0.001,"Tier rate"]],"auth":[[0.0,750000.0,0.0014,"List rate"],[750001.0,15000000.0,0.0013,"Tier rate"],[15000001.0,20000000.0,0.0012,"Tier rate"],[20000001.0,50000000.0,0.0011,"Tier rate"],[50000001.0,100000000.0,0.0011,"Tier rate"],[100000001.0,null,0.001,"Tier rate"]],"authIntl":[[0.0,750000.0,0.0304,"List rate"],[750001.0,15000000.0,0.0286,"Tier rate"],[15000001.0,20000000.0,0.0268,"Tier rate"],[20000001.0,50000000.0,0.0249,"Tier rate"],[50000001.0,100000000.0,0.0231,"Tier rate"],[100000001.0,null,0.0213,"Tier rate"]]}},"Indonesia":{"ar":"إندونيسيا","mkt":0.0411,"util":0.025,"auth":0.025,"authIntl":0.136,"service":0.025,"tiers":{"util":[[0.0,750000.0,0.025,"List rate"],[750001.0,4000000.0,0.0238,"Tier rate"],[4000001.0,25000000.0,0.0225,"Tier rate"],[25000001.0,75000000.0,0.0213,"Tier rate"],[75000001.0,150000000.0,0.02,"Tier rate"],[150000001.0,null,0.0188,"Tier rate"]],"auth":[[0.0,750000.0,0.025,"List rate"],[750001.0,2000000.0,0.0238,"Tier rate"],[2000001.0,6000000.0,0.0225,"Tier rate"],[6000001.0,30000000.0,0.0213,"Tier rate"],[30000001.0,60000000.0,0.02,"Tier rate"],[60000001.0,null,0.0188,"Tier rate"]],"authIntl":[[0.0,750000.0,0.136,"List rate"],[750001.0,2000000.0,0.1292,"Tier rate"],[2000001.0,6000000.0,0.1224,"Tier rate"],[6000001.0,30000000.0,0.1156,"Tier rate"],[30000001.0,60000000.0,0.1088,"Tier rate"],[60000001.0,null,0.102,"Tier rate"]]}},"Iraq":{"ar":"العراق","mkt":0.0341,"util":0.0079,"auth":0.0079,"authIntl":0.128,"service":0.0079,"tiers":{"util":[[0.0,100000.0,0.0079,"List rate"],[100001.0,1000000.0,0.0075,"Tier rate"],[1000001.0,4500000.0,0.0071,"Tier rate"],[4500001.0,40000000.0,0.0067,"Tier rate"],[40000001.0,80000000.0,0.0063,"Tier rate"],[80000001.0,null,0.0059,"Tier rate"]],"auth":[[0.0,300000.0,0.0079,"List rate"],[300001.0,2000000.0,0.0075,"Tier rate"],[2000001.0,10000000.0,0.0071,"Tier rate"],[10000001.0,20000000.0,0.0067,"Tier rate"],[20000001.0,40000000.0,0.0063,"Tier rate"],[40000001.0,null,0.0059,"Tier rate"]],"authIntl":[[0.0,300000.0,0.128,"List rate"],[300001.0,2000000.0,0.1216,"Tier rate"],[2000001.0,10000000.0,0.1152,"Tier rate"],[10000001.0,20000000.0,0.1088,"Tier rate"],[20000001.0,40000000.0,0.1024,"Tier rate"],[40000001.0,null,0.096,"Tier rate"]]}},"Israel":{"ar":"إسرائيل","mkt":0.0353,"util":0.0053,"auth":0.0053,"authIntl":null,"service":0.0053,"tiers":{"util":[[0.0,100000.0,0.0053,"List rate"],[100001.0,1000000.0,0.005,"Tier rate"],[1000001.0,4500000.0,0.0048,"Tier rate"],[4500001.0,40000000.0,0.0045,"Tier rate"],[40000001.0,80000000.0,0.0042,"Tier rate"],[80000001.0,null,0.004,"Tier rate"]],"auth":[[0.0,300000.0,0.0053,"List rate"],[300001.0,2000000.0,0.005,"Tier rate"],[2000001.0,10000000.0,0.0048,"Tier rate"],[10000001.0,20000000.0,0.0045,"Tier rate"],[20000001.0,40000000.0,0.0042,"Tier rate"],[40000001.0,null,0.004,"Tier rate"]]}},"Italy":{"ar":"إيطاليا","mkt":0.0795,"util":0.03,"auth":0.03,"authIntl":null,"service":0.03,"tiers":{"util":[[0.0,100000.0,0.03,"List rate"],[100001.0,1000000.0,0.0285,"Tier rate"],[1000001.0,4500000.0,0.027,"Tier rate"],[4500001.0,40000000.0,0.0255,"Tier rate"],[40000001.0,80000000.0,0.024,"Tier rate"],[80000001.0,null,0.0225,"Tier rate"]],"auth":[[0.0,300000.0,0.03,"List rate"],[300001.0,2000000.0,0.0285,"Tier rate"],[2000001.0,10000000.0,0.027,"Tier rate"],[10000001.0,20000000.0,0.0255,"Tier rate"],[20000001.0,40000000.0,0.024,"Tier rate"],[40000001.0,null,0.0225,"Tier rate"]]}},"Kazakhstan":{"ar":"كازاخستان","mkt":0.0604,"util":0.018,"auth":0.018,"authIntl":0.16,"service":0.018,"tiers":{"util":[[0.0,80000.0,0.018,"List rate"],[80001.0,750000.0,0.0171,"Tier rate"],[750001.0,2250000.0,0.0162,"Tier rate"],[2250001.0,3000000.0,0.0153,"Tier rate"],[3000001.0,6000000.0,0.0144,"Tier rate"],[6000001.0,null,0.0135,"Tier rate"]],"auth":[[0.0,100000.0,0.018,"List rate"],[100001.0,500000.0,0.0171,"Tier rate"],[500001.0,2000000.0,0.0162,"Tier rate"],[2000001.0,5000000.0,0.0153,"Tier rate"],[5000001.0,10000000.0,0.0144,"Tier rate"],[10000001.0,null,0.0135,"Tier rate"]],"authIntl":[[0.0,100000.0,0.16,"List rate"],[100001.0,500000.0,0.152,"Tier rate"],[500001.0,2000000.0,0.144,"Tier rate"],[2000001.0,5000000.0,0.136,"Tier rate"],[5000001.0,10000000.0,0.128,"Tier rate"],[10000001.0,null,0.12,"Tier rate"]]}},"Kuwait":{"ar":"الكويت","mkt":0.0792,"util":0.044,"auth":0.044,"authIntl":0.12,"service":0.044,"tiers":{"util":[[0.0,100000.0,0.044,"List rate"],[100001.0,1000000.0,0.0418,"Tier rate"],[1000001.0,4500000.0,0.0396,"Tier rate"],[4500001.0,40000000.0,0.0374,"Tier rate"],[40000001.0,80000000.0,0.0352,"Tier rate"],[80000001.0,null,0.033,"Tier rate"]],"auth":[[0.0,300000.0,0.044,"List rate"],[300001.0,2000000.0,0.0418,"Tier rate"],[2000001.0,10000000.0,0.0396,"Tier rate"],[10000001.0,20000000.0,0.0374,"Tier rate"],[20000001.0,40000000.0,0.0352,"Tier rate"],[40000001.0,null,0.033,"Tier rate"]],"authIntl":[[0.0,300000.0,0.12,"List rate"],[300001.0,2000000.0,0.114,"Tier rate"],[2000001.0,10000000.0,0.108,"Tier rate"],[10000001.0,20000000.0,0.102,"Tier rate"],[20000001.0,40000000.0,0.096,"Tier rate"],[40000001.0,null,0.09,"Tier rate"]]}},"Malaysia":{"ar":"ماليزيا","mkt":0.086,"util":0.014,"auth":0.014,"authIntl":0.0418,"service":0.014,"tiers":{"util":[[0.0,150000.0,0.014,"List rate"],[150001.0,1000000.0,0.0133,"Tier rate"],[1000001.0,4000000.0,0.0126,"Tier rate"],[4000001.0,25000000.0,0.0119,"Tier rate"],[25000001.0,50000000.0,0.0112,"Tier rate"],[50000001.0,null,0.0105,"Tier rate"]],"auth":[[0.0,100000.0,0.014,"List rate"],[100001.0,300000.0,0.0133,"Tier rate"],[300001.0,1000000.0,0.0126,"Tier rate"],[1000001.0,10000000.0,0.0119,"Tier rate"],[10000001.0,20000000.0,0.0112,"Tier rate"],[20000001.0,null,0.0105,"Tier rate"]],"authIntl":[[0.0,100000.0,0.0418,"List rate"],[100001.0,300000.0,0.0397,"Tier rate"],[300001.0,1000000.0,0.0376,"Tier rate"],[1000001.0,10000000.0,0.0355,"Tier rate"],[10000001.0,20000000.0,0.0334,"Tier rate"],[20000001.0,null,0.0314,"Tier rate"]]}},"Mexico":{"ar":"المكسيك","mkt":0.0397,"util":0.0085,"auth":0.0085,"authIntl":null,"service":0.0085,"tiers":{"util":[[0.0,1000000.0,0.0085,"List rate"],[1000001.0,5000000.0,0.0081,"Tier rate"],[5000001.0,10000000.0,0.0077,"Tier rate"],[10000001.0,20000000.0,0.0072,"Tier rate"],[20000001.0,40000000.0,0.0068,"Tier rate"],[40000001.0,null,0.0064,"Tier rate"]],"auth":[[0.0,250000.0,0.0085,"List rate"],[250001.0,1000000.0,0.0081,"Tier rate"],[1000001.0,3000000.0,0.0077,"Tier rate"],[3000001.0,5000000.0,0.0072,"Tier rate"],[5000001.0,10000000.0,0.0068,"Tier rate"],[10000001.0,null,0.0064,"Tier rate"]]}},"Morocco":{"ar":"المغرب","mkt":0.0414,"util":0.023,"auth":0.023,"authIntl":0.0811,"service":0.023,"tiers":{"util":[[0.0,100000.0,0.023,"List rate"],[100001.0,1000000.0,0.0219,"Tier rate"],[1000001.0,4500000.0,0.0207,"Tier rate"],[4500001.0,40000000.0,0.0196,"Tier rate"],[40000001.0,80000000.0,0.0184,"Tier rate"],[80000001.0,null,0.0173,"Tier rate"]],"auth":[[0.0,300000.0,0.023,"List rate"],[300001.0,2000000.0,0.0219,"Tier rate"],[2000001.0,10000000.0,0.0207,"Tier rate"],[10000001.0,20000000.0,0.0196,"Tier rate"],[20000001.0,40000000.0,0.0184,"Tier rate"],[40000001.0,null,0.0173,"Tier rate"]],"authIntl":[[0.0,300000.0,0.0811,"List rate"],[300001.0,2000000.0,0.077,"Tier rate"],[2000001.0,10000000.0,0.073,"Tier rate"],[10000001.0,20000000.0,0.0689,"Tier rate"],[20000001.0,40000000.0,0.0649,"Tier rate"],[40000001.0,null,0.0608,"Tier rate"]]}},"Netherlands":{"ar":"هولندا","mkt":0.1597,"util":0.05,"auth":0.05,"authIntl":null,"service":0.05,"tiers":{"util":[[0.0,100000.0,0.05,"List rate"],[100001.0,1000000.0,0.0475,"Tier rate"],[1000001.0,4500000.0,0.045,"Tier rate"],[4500001.0,40000000.0,0.0425,"Tier rate"],[40000001.0,80000000.0,0.04,"Tier rate"],[80000001.0,null,0.0375,"Tier rate"]],"auth":[[0.0,300000.0,0.05,"List rate"],[300001.0,2000000.0,0.0475,"Tier rate"],[2000001.0,10000000.0,0.045,"Tier rate"],[10000001.0,20000000.0,0.0425,"Tier rate"],[20000001.0,40000000.0,0.04,"Tier rate"],[40000001.0,null,0.0375,"Tier rate"]]}},"Nepal":{"ar":"نيبال","mkt":0.0732,"util":0.0034,"auth":0.0034,"authIntl":0.112,"service":0.0034,"tiers":{"util":[[0.0,150000.0,0.0034,"List rate"],[150001.0,1000000.0,0.0032,"Tier rate"],[1000001.0,4000000.0,0.0031,"Tier rate"],[4000001.0,25000000.0,0.0029,"Tier rate"],[25000001.0,50000000.0,0.0027,"Tier rate"],[50000001.0,null,0.0026,"Tier rate"]],"auth":[[0.0,100000.0,0.0034,"List rate"],[100001.0,300000.0,0.0032,"Tier rate"],[300001.0,1000000.0,0.0031,"Tier rate"],[1000001.0,10000000.0,0.0029,"Tier rate"],[10000001.0,20000000.0,0.0027,"Tier rate"],[20000001.0,null,0.0026,"Tier rate"]],"authIntl":[[0.0,100000.0,0.112,"List rate"],[100001.0,300000.0,0.1064,"Tier rate"],[300001.0,1000000.0,0.1008,"Tier rate"],[1000001.0,10000000.0,0.0952,"Tier rate"],[10000001.0,20000000.0,0.0896,"Tier rate"],[20000001.0,null,0.084,"Tier rate"]]}},"Nigeria":{"ar":"نيجيريا","mkt":0.0516,"util":0.0067,"auth":0.0067,"authIntl":0.075,"service":0.0067,"tiers":{"util":[[0.0,100000.0,0.0067,"List rate"],[100001.0,1000000.0,0.0064,"Tier rate"],[1000001.0,4500000.0,0.006,"Tier rate"],[4500001.0,40000000.0,0.0057,"Tier rate"],[40000001.0,80000000.0,0.0054,"Tier rate"],[80000001.0,null,0.005,"Tier rate"]],"auth":[[0.0,300000.0,0.0067,"List rate"],[300001.0,2000000.0,0.0064,"Tier rate"],[2000001.0,10000000.0,0.006,"Tier rate"],[10000001.0,20000000.0,0.0057,"Tier rate"],[20000001.0,40000000.0,0.0054,"Tier rate"],[40000001.0,null,0.005,"Tier rate"]],"authIntl":[[0.0,300000.0,0.075,"List rate"],[300001.0,2000000.0,0.0713,"Tier rate"],[2000001.0,10000000.0,0.0675,"Tier rate"],[10000001.0,20000000.0,0.0638,"Tier rate"],[20000001.0,40000000.0,0.06,"Tier rate"],[40000001.0,null,0.0563,"Tier rate"]]}},"Oman":{"ar":"عُمان","mkt":0.0341,"util":0.0247,"auth":0.0247,"authIntl":0.06,"service":0.0247,"tiers":{"util":[[0.0,100000.0,0.0247,"List rate"],[100001.0,1000000.0,0.0235,"Tier rate"],[1000001.0,4500000.0,0.0222,"Tier rate"],[4500001.0,40000000.0,0.021,"Tier rate"],[40000001.0,80000000.0,0.0198,"Tier rate"],[80000001.0,null,0.0185,"Tier rate"]],"auth":[[0.0,300000.0,0.0247,"List rate"],[300001.0,2000000.0,0.0235,"Tier rate"],[2000001.0,10000000.0,0.0222,"Tier rate"],[10000001.0,20000000.0,0.021,"Tier rate"],[20000001.0,40000000.0,0.0198,"Tier rate"],[40000001.0,null,0.0185,"Tier rate"]],"authIntl":[[0.0,300000.0,0.06,"List rate"],[300001.0,2000000.0,0.057,"Tier rate"],[2000001.0,10000000.0,0.054,"Tier rate"],[10000001.0,20000000.0,0.051,"Tier rate"],[20000001.0,40000000.0,0.048,"Tier rate"],[40000001.0,null,0.045,"Tier rate"]]}},"Pakistan":{"ar":"باكستان","mkt":0.0473,"util":0.015,"auth":0.015,"authIntl":0.075,"service":0.015,"tiers":{"util":[[0.0,150000.0,0.015,"List rate"],[150001.0,1000000.0,0.0143,"Tier rate"],[1000001.0,4000000.0,0.0135,"Tier rate"],[4000001.0,25000000.0,0.0128,"Tier rate"],[25000001.0,50000000.0,0.012,"Tier rate"],[50000001.0,null,0.0113,"Tier rate"]],"auth":[[0.0,100000.0,0.015,"List rate"],[100001.0,300000.0,0.0143,"Tier rate"],[300001.0,1000000.0,0.0135,"Tier rate"],[1000001.0,10000000.0,0.0128,"Tier rate"],[10000001.0,20000000.0,0.012,"Tier rate"],[20000001.0,null,0.0113,"Tier rate"]],"authIntl":[[0.0,100000.0,0.075,"List rate"],[100001.0,300000.0,0.0713,"Tier rate"],[300001.0,1000000.0,0.0675,"Tier rate"],[1000001.0,10000000.0,0.0638,"Tier rate"],[10000001.0,20000000.0,0.06,"Tier rate"],[20000001.0,null,0.0563,"Tier rate"]]}},"Peru":{"ar":"بيرو","mkt":0.0703,"util":0.03,"auth":0.03,"authIntl":null,"service":0.03,"tiers":{"util":[[0.0,100000.0,0.03,"List rate"],[100001.0,1000000.0,0.0285,"Tier rate"],[1000001.0,4500000.0,0.027,"Tier rate"],[4500001.0,15000000.0,0.0255,"Tier rate"],[15000001.0,30000000.0,0.024,"Tier rate"],[30000001.0,null,0.0225,"Tier rate"]],"auth":[[0.0,120000.0,0.03,"List rate"],[120001.0,400000.0,0.0285,"Tier rate"],[400001.0,1000000.0,0.027,"Tier rate"],[1000001.0,5000000.0,0.0255,"Tier rate"],[5000001.0,10000000.0,0.024,"Tier rate"],[10000001.0,null,0.0225,"Tier rate"]]}},"Poland":{"ar":"بولندا","mkt":0.0366,"util":0.0122,"auth":0.0122,"authIntl":null,"service":0.0122,"tiers":{"util":[[0.0,100000.0,0.0122,"List rate"],[100001.0,1000000.0,0.0116,"Tier rate"],[1000001.0,4500000.0,0.011,"Tier rate"],[4500001.0,40000000.0,0.0104,"Tier rate"],[40000001.0,80000000.0,0.0098,"Tier rate"],[80000001.0,null,0.0092,"Tier rate"]],"auth":[[0.0,300000.0,0.0122,"List rate"],[300001.0,2000000.0,0.0116,"Tier rate"],[2000001.0,10000000.0,0.011,"Tier rate"],[10000001.0,20000000.0,0.0104,"Tier rate"],[20000001.0,40000000.0,0.0098,"Tier rate"],[40000001.0,null,0.0092,"Tier rate"]]}},"Qatar":{"ar":"قطر","mkt":0.0341,"util":0.012,"auth":0.012,"authIntl":null,"service":0.012,"tiers":{"util":[[0.0,100000.0,0.012,"List rate"],[100001.0,1000000.0,0.0114,"Tier rate"],[1000001.0,4500000.0,0.0108,"Tier rate"],[4500001.0,40000000.0,0.0102,"Tier rate"],[40000001.0,80000000.0,0.0096,"Tier rate"],[80000001.0,null,0.009,"Tier rate"]],"auth":[[0.0,300000.0,0.012,"List rate"],[300001.0,2000000.0,0.0114,"Tier rate"],[2000001.0,10000000.0,0.0108,"Tier rate"],[10000001.0,20000000.0,0.0102,"Tier rate"],[20000001.0,40000000.0,0.0096,"Tier rate"],[40000001.0,null,0.009,"Tier rate"]]}},"Romania":{"ar":"رومانيا","mkt":0.086,"util":0.029,"auth":0.029,"authIntl":null,"service":0.029,"tiers":{"util":[[0.0,100000.0,0.029,"List rate"],[100001.0,1000000.0,0.0276,"Tier rate"],[1000001.0,4500000.0,0.0261,"Tier rate"],[4500001.0,40000000.0,0.0247,"Tier rate"],[40000001.0,80000000.0,0.0232,"Tier rate"],[80000001.0,null,0.0218,"Tier rate"]],"auth":[[0.0,300000.0,0.029,"List rate"],[300001.0,2000000.0,0.0276,"Tier rate"],[2000001.0,10000000.0,0.0261,"Tier rate"],[10000001.0,20000000.0,0.0247,"Tier rate"],[20000001.0,40000000.0,0.0232,"Tier rate"],[40000001.0,null,0.0218,"Tier rate"]]}},"Russia":{"ar":"روسيا","mkt":0.0802,"util":0.04,"auth":0.04,"authIntl":null,"service":0.04,"tiers":{"util":[[0.0,100000.0,0.04,"List rate"],[100001.0,1000000.0,0.038,"Tier rate"],[1000001.0,4500000.0,0.036,"Tier rate"],[4500001.0,40000000.0,0.034,"Tier rate"],[40000001.0,80000000.0,0.032,"Tier rate"],[80000001.0,null,0.03,"Tier rate"]],"auth":[[0.0,300000.0,0.04,"List rate"],[300001.0,2000000.0,0.038,"Tier rate"],[2000001.0,10000000.0,0.036,"Tier rate"],[10000001.0,20000000.0,0.034,"Tier rate"],[20000001.0,40000000.0,0.032,"Tier rate"],[40000001.0,null,0.03,"Tier rate"]]}},"Saudi Arabia":{"ar":"السعودية","mkt":0.0576,"util":0.0107,"auth":0.0107,"authIntl":0.0598,"service":0.0107,"tiers":{"util":[[0.0,100000.0,0.0107,"List rate"],[100001.0,1000000.0,0.0102,"Tier rate"],[1000001.0,4500000.0,0.0096,"Tier rate"],[4500001.0,40000000.0,0.0091,"Tier rate"],[40000001.0,80000000.0,0.0086,"Tier rate"],[80000001.0,null,0.008,"Tier rate"]],"auth":[[0.0,300000.0,0.0107,"List rate"],[300001.0,2000000.0,0.0102,"Tier rate"],[2000001.0,10000000.0,0.0096,"Tier rate"],[10000001.0,20000000.0,0.0091,"Tier rate"],[20000001.0,40000000.0,0.0086,"Tier rate"],[40000001.0,null,0.008,"Tier rate"]],"authIntl":[[0.0,300000.0,0.0598,"List rate"],[300001.0,2000000.0,0.0568,"Tier rate"],[2000001.0,10000000.0,0.0538,"Tier rate"],[10000001.0,20000000.0,0.0508,"Tier rate"],[20000001.0,40000000.0,0.0478,"Tier rate"],[40000001.0,null,0.0449,"Tier rate"]]}},"Singapore":{"ar":"سنغافورة","mkt":0.0732,"util":0.016,"auth":0.016,"authIntl":null,"service":0.016,"tiers":{"util":[[0.0,150000.0,0.016,"List rate"],[150001.0,1000000.0,0.0152,"Tier rate"],[1000001.0,4000000.0,0.0144,"Tier rate"],[4000001.0,25000000.0,0.0136,"Tier rate"],[25000001.0,50000000.0,0.0128,"Tier rate"],[50000001.0,null,0.012,"Tier rate"]],"auth":[[0.0,100000.0,0.016,"List rate"],[100001.0,300000.0,0.0152,"Tier rate"],[300001.0,1000000.0,0.0144,"Tier rate"],[1000001.0,10000000.0,0.0136,"Tier rate"],[10000001.0,20000000.0,0.0128,"Tier rate"],[20000001.0,null,0.012,"Tier rate"]]}},"South Africa":{"ar":"جنوب أفريقيا","mkt":0.0379,"util":0.0095,"auth":0.0095,"authIntl":0.02,"service":0.0095,"tiers":{"util":[[0.0,100000.0,0.0095,"List rate"],[100001.0,1000000.0,0.009,"Tier rate"],[1000001.0,4500000.0,0.0086,"Tier rate"],[4500001.0,40000000.0,0.0081,"Tier rate"],[40000001.0,80000000.0,0.0076,"Tier rate"],[80000001.0,null,0.0071,"Tier rate"]],"auth":[[0.0,300000.0,0.0095,"List rate"],[300001.0,2000000.0,0.009,"Tier rate"],[2000001.0,10000000.0,0.0086,"Tier rate"],[10000001.0,20000000.0,0.0081,"Tier rate"],[20000001.0,40000000.0,0.0076,"Tier rate"],[40000001.0,null,0.0071,"Tier rate"]],"authIntl":[[0.0,300000.0,0.02,"List rate"],[300001.0,2000000.0,0.019,"Tier rate"],[2000001.0,10000000.0,0.018,"Tier rate"],[10000001.0,20000000.0,0.017,"Tier rate"],[20000001.0,40000000.0,0.016,"Tier rate"],[40000001.0,null,0.015,"Tier rate"]]}},"Spain":{"ar":"إسبانيا","mkt":0.0707,"util":0.02,"auth":0.02,"authIntl":null,"service":0.02,"tiers":{"util":[[0.0,100000.0,0.02,"List rate"],[100001.0,1000000.0,0.019,"Tier rate"],[1000001.0,4500000.0,0.018,"Tier rate"],[4500001.0,40000000.0,0.017,"Tier rate"],[40000001.0,80000000.0,0.016,"Tier rate"],[80000001.0,null,0.015,"Tier rate"]],"auth":[[0.0,300000.0,0.02,"List rate"],[300001.0,2000000.0,0.019,"Tier rate"],[2000001.0,10000000.0,0.018,"Tier rate"],[10000001.0,20000000.0,0.017,"Tier rate"],[20000001.0,40000000.0,0.016,"Tier rate"],[40000001.0,null,0.015,"Tier rate"]]}},"Sri Lanka":{"ar":"سريلانكا","mkt":0.0732,"util":0.002,"auth":0.002,"authIntl":0.144,"service":0.002,"tiers":{"util":[[0.0,150000.0,0.002,"List rate"],[150001.0,1000000.0,0.0019,"Tier rate"],[1000001.0,4000000.0,0.0018,"Tier rate"],[4000001.0,25000000.0,0.0017,"Tier rate"],[25000001.0,50000000.0,0.0016,"Tier rate"],[50000001.0,null,0.0015,"Tier rate"]],"auth":[[0.0,100000.0,0.002,"List rate"],[100001.0,300000.0,0.0019,"Tier rate"],[300001.0,1000000.0,0.0018,"Tier rate"],[1000001.0,10000000.0,0.0017,"Tier rate"],[10000001.0,20000000.0,0.0016,"Tier rate"],[20000001.0,null,0.0015,"Tier rate"]],"authIntl":[[0.0,100000.0,0.144,"List rate"],[100001.0,300000.0,0.1368,"Tier rate"],[300001.0,1000000.0,0.1296,"Tier rate"],[1000001.0,10000000.0,0.1224,"Tier rate"],[10000001.0,20000000.0,0.1152,"Tier rate"],[20000001.0,null,0.108,"Tier rate"]]}},"Turkey":{"ar":"تركيا","mkt":0.0109,"util":0.0009,"auth":0.0009,"authIntl":null,"service":0.0009,"tiers":{"util":[[0.0,100000.0,0.0009,"List rate"],[100001.0,1000000.0,0.0009,"Tier rate"],[1000001.0,4500000.0,0.0008,"Tier rate"],[4500001.0,40000000.0,0.0008,"Tier rate"],[40000001.0,80000000.0,0.0007,"Tier rate"],[80000001.0,null,0.0007,"Tier rate"]],"auth":[[0.0,300000.0,0.0009,"List rate"],[300001.0,2000000.0,0.0009,"Tier rate"],[2000001.0,10000000.0,0.0008,"Tier rate"],[10000001.0,20000000.0,0.0008,"Tier rate"],[20000001.0,40000000.0,0.0007,"Tier rate"],[40000001.0,null,0.0007,"Tier rate"]]}},"Ukraine":{"ar":"أوكرانيا","mkt":0.086,"util":0.0298,"auth":0.0298,"authIntl":0.0746,"service":0.0298,"tiers":{"util":[[0.0,100000.0,0.0298,"List rate"],[100001.0,1000000.0,0.0283,"Tier rate"],[1000001.0,4500000.0,0.0268,"Tier rate"],[4500001.0,40000000.0,0.0253,"Tier rate"],[40000001.0,80000000.0,0.0238,"Tier rate"],[80000001.0,null,0.0224,"Tier rate"]],"auth":[[0.0,300000.0,0.0298,"List rate"],[300001.0,2000000.0,0.0283,"Tier rate"],[2000001.0,10000000.0,0.0268,"Tier rate"],[10000001.0,20000000.0,0.0253,"Tier rate"],[20000001.0,40000000.0,0.0238,"Tier rate"],[40000001.0,null,0.0224,"Tier rate"]],"authIntl":[[0.0,300000.0,0.0746,"List rate"],[300001.0,2000000.0,0.0709,"Tier rate"],[2000001.0,10000000.0,0.0671,"Tier rate"],[10000001.0,20000000.0,0.0634,"Tier rate"],[20000001.0,40000000.0,0.0597,"Tier rate"],[40000001.0,null,0.056,"Tier rate"]]}},"United Arab Emirates":{"ar":"الإمارات","mkt":0.0576,"util":0.0157,"auth":0.0157,"authIntl":0.051,"service":0.0157,"tiers":{"util":[[0.0,100000.0,0.0157,"List rate"],[100001.0,1000000.0,0.0149,"Tier rate"],[1000001.0,4500000.0,0.0141,"Tier rate"],[4500001.0,40000000.0,0.0133,"Tier rate"],[40000001.0,80000000.0,0.0126,"Tier rate"],[80000001.0,null,0.0118,"Tier rate"]],"auth":[[0.0,300000.0,0.0157,"List rate"],[300001.0,2000000.0,0.0149,"Tier rate"],[2000001.0,10000000.0,0.0141,"Tier rate"],[10000001.0,20000000.0,0.0133,"Tier rate"],[20000001.0,40000000.0,0.0126,"Tier rate"],[40000001.0,null,0.0118,"Tier rate"]],"authIntl":[[0.0,300000.0,0.051,"List rate"],[300001.0,2000000.0,0.0485,"Tier rate"],[2000001.0,10000000.0,0.0459,"Tier rate"],[10000001.0,20000000.0,0.0434,"Tier rate"],[20000001.0,40000000.0,0.0408,"Tier rate"],[40000001.0,null,0.0383,"Tier rate"]]}},"United Kingdom":{"ar":"المملكة المتحدة","mkt":0.0635,"util":0.022,"auth":0.022,"authIntl":null,"service":0.022,"tiers":{"util":[[0.0,100000.0,0.022,"List rate"],[100001.0,1000000.0,0.0209,"Tier rate"],[1000001.0,4500000.0,0.0198,"Tier rate"],[4500001.0,40000000.0,0.0187,"Tier rate"],[40000001.0,80000000.0,0.0176,"Tier rate"],[80000001.0,null,0.0165,"Tier rate"]],"auth":[[0.0,300000.0,0.022,"List rate"],[300001.0,2000000.0,0.0209,"Tier rate"],[2000001.0,10000000.0,0.0198,"Tier rate"],[10000001.0,20000000.0,0.0187,"Tier rate"],[20000001.0,40000000.0,0.0176,"Tier rate"],[40000001.0,null,0.0165,"Tier rate"]]}},"North America":{"ar":"أمريكا الشمالية","mkt":0.025,"util":0.0034,"auth":0.0034,"authIntl":null,"service":0.0034,"tiers":{"util":[[0.0,80000.0,0.0034,"List rate"],[80001.0,750000.0,0.0032,"Tier rate"],[750001.0,2250000.0,0.0031,"Tier rate"],[2250001.0,3000000.0,0.0029,"Tier rate"],[3000001.0,6000000.0,0.0027,"Tier rate"],[6000001.0,null,0.0026,"Tier rate"]],"auth":[[0.0,100000.0,0.0034,"List rate"],[100001.0,500000.0,0.0032,"Tier rate"],[500001.0,2000000.0,0.0031,"Tier rate"],[2000001.0,5000000.0,0.0029,"Tier rate"],[5000001.0,10000000.0,0.0027,"Tier rate"],[10000001.0,null,0.0026,"Tier rate"]]}},"Rest of Africa":{"ar":"بقية أفريقيا","mkt":0.0225,"util":0.004,"auth":0.004,"authIntl":null,"service":0.004,"tiers":{"util":[[0.0,100000.0,0.004,"List rate"],[100001.0,1000000.0,0.0038,"Tier rate"],[1000001.0,4500000.0,0.0036,"Tier rate"],[4500001.0,40000000.0,0.0034,"Tier rate"],[40000001.0,80000000.0,0.0032,"Tier rate"],[80000001.0,null,0.003,"Tier rate"]],"auth":[[0.0,300000.0,0.004,"List rate"],[300001.0,2000000.0,0.0038,"Tier rate"],[2000001.0,10000000.0,0.0036,"Tier rate"],[10000001.0,20000000.0,0.0034,"Tier rate"],[20000001.0,40000000.0,0.0032,"Tier rate"],[40000001.0,null,0.003,"Tier rate"]]}},"Rest of Asia Pacific":{"ar":"بقية آسيا والمحيط الهادئ","mkt":0.0842,"util":0.0113,"auth":0.0113,"authIntl":null,"service":0.0113,"tiers":{"util":[[0.0,150000.0,0.0113,"List rate"],[150001.0,1000000.0,0.0107,"Tier rate"],[1000001.0,4000000.0,0.0102,"Tier rate"],[4000001.0,25000000.0,0.0096,"Tier rate"],[25000001.0,50000000.0,0.009,"Tier rate"],[50000001.0,null,0.0085,"Tier rate"]],"auth":[[0.0,100000.0,0.0113,"List rate"],[100001.0,300000.0,0.0107,"Tier rate"],[300001.0,1000000.0,0.0102,"Tier rate"],[1000001.0,10000000.0,0.0096,"Tier rate"],[10000001.0,20000000.0,0.009,"Tier rate"],[20000001.0,null,0.0085,"Tier rate"]]}},"Rest of Central & Eastern Europe":{"ar":"بقية وسط وشرق أوروبا","mkt":0.086,"util":0.0212,"auth":0.0212,"authIntl":null,"service":0.0212,"tiers":{"util":[[0.0,100000.0,0.0212,"List rate"],[100001.0,1000000.0,0.0201,"Tier rate"],[1000001.0,4500000.0,0.019,"Tier rate"],[4500001.0,40000000.0,0.018,"Tier rate"],[40000001.0,80000000.0,0.0169,"Tier rate"],[80000001.0,null,0.0159,"Tier rate"]],"auth":[[0.0,300000.0,0.0212,"List rate"],[300001.0,2000000.0,0.0201,"Tier rate"],[2000001.0,10000000.0,0.019,"Tier rate"],[10000001.0,20000000.0,0.018,"Tier rate"],[20000001.0,40000000.0,0.0169,"Tier rate"],[40000001.0,null,0.0159,"Tier rate"]]}},"Rest of Latin America":{"ar":"بقية أمريكا اللاتينية","mkt":0.074,"util":0.0113,"auth":0.0113,"authIntl":null,"service":0.0113,"tiers":{"util":[[0.0,100000.0,0.0113,"List rate"],[100001.0,1000000.0,0.0107,"Tier rate"],[1000001.0,4500000.0,0.0102,"Tier rate"],[4500001.0,15000000.0,0.0096,"Tier rate"],[15000001.0,30000000.0,0.009,"Tier rate"],[30000001.0,null,0.0085,"Tier rate"]],"auth":[[0.0,120000.0,0.0113,"List rate"],[120001.0,400000.0,0.0107,"Tier rate"],[400001.0,1000000.0,0.0102,"Tier rate"],[1000001.0,5000000.0,0.0096,"Tier rate"],[5000001.0,10000000.0,0.009,"Tier rate"],[10000001.0,null,0.0085,"Tier rate"]]}},"Rest of Middle East":{"ar":"بقية الشرق الأوسط","mkt":0.0392,"util":0.0091,"auth":0.0091,"authIntl":null,"service":0.0091,"tiers":{"util":[[0.0,100000.0,0.0091,"List rate"],[100001.0,1000000.0,0.0086,"Tier rate"],[1000001.0,4500000.0,0.0082,"Tier rate"],[4500001.0,40000000.0,0.0077,"Tier rate"],[40000001.0,80000000.0,0.0073,"Tier rate"],[80000001.0,null,0.0068,"Tier rate"]],"auth":[[0.0,300000.0,0.0091,"List rate"],[300001.0,2000000.0,0.0086,"Tier rate"],[2000001.0,10000000.0,0.0082,"Tier rate"],[10000001.0,20000000.0,0.0077,"Tier rate"],[20000001.0,40000000.0,0.0073,"Tier rate"],[40000001.0,null,0.0068,"Tier rate"]]}},"Rest of Western Europe":{"ar":"بقية غرب أوروبا","mkt":0.0592,"util":0.0171,"auth":0.0171,"authIntl":null,"service":0.0171,"tiers":{"util":[[0.0,100000.0,0.0171,"List rate"],[100001.0,1000000.0,0.0162,"Tier rate"],[1000001.0,4500000.0,0.0154,"Tier rate"],[4500001.0,40000000.0,0.0145,"Tier rate"],[40000001.0,80000000.0,0.0137,"Tier rate"],[80000001.0,null,0.0128,"Tier rate"]],"auth":[[0.0,300000.0,0.0171,"List rate"],[300001.0,2000000.0,0.0162,"Tier rate"],[2000001.0,10000000.0,0.0154,"Tier rate"],[10000001.0,20000000.0,0.0145,"Tier rate"],[20000001.0,40000000.0,0.0137,"Tier rate"],[40000001.0,null,0.0128,"Tier rate"]]}},"Other":{"ar":"دول أخرى","mkt":0.0604,"util":0.0077,"auth":0.0077,"authIntl":null,"service":0.0077,"tiers":{"util":[[0.0,80000.0,0.0077,"List rate"],[80001.0,750000.0,0.0073,"Tier rate"],[750001.0,2250000.0,0.0069,"Tier rate"],[2250001.0,3000000.0,0.0065,"Tier rate"],[3000001.0,6000000.0,0.0062,"Tier rate"],[6000001.0,null,0.0058,"Tier rate"]],"auth":[[0.0,100000.0,0.0077,"List rate"],[100001.0,500000.0,0.0073,"Tier rate"],[500001.0,2000000.0,0.0069,"Tier rate"],[2000001.0,5000000.0,0.0065,"Tier rate"],[5000001.0,10000000.0,0.0062,"Tier rate"],[10000001.0,null,0.0058,"Tier rate"]]}}};

  var PRIORITY = [
    "Egypt", "Saudi Arabia", "United Arab Emirates", "Kuwait", "Qatar", "Oman",
    "Jordan", "Iraq", "Morocco", "Turkey", "Nigeria", "South Africa",
    "United Kingdom", "Germany", "France", "North America"
  ];

  var COLORS = {
    marketing: "#0a4dff",
    utility: "#12b76a",
    authentication: "#ffb020",
    service: "#6b4dff",
    agent: "#0a0f1a"
  };

  var LABELS = {
    marketing: "تسويق",
    utility: "تأكيد طلب",
    authentication: "كود تحقق",
    service: "خدمة",
    agent: "وكيل ميتا الذكي"
  };

  var AGENT_PER_MSG = 0.045; // ≈22.5k tokens × $2.00 / 1M tokens

  var el = function (id) { return document.getElementById(id); };

  function num(id) {
    var v = parseFloat(el(id).value);
    return isFinite(v) && v > 0 ? v : 0;
  }

  function usd(v) {
    return '<bdi dir="ltr">$' + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "</bdi>";
  }

  function egp(v) {
    return '<bdi dir="ltr">' + Math.round(v).toLocaleString("en-US") + "</bdi> ج.م";
  }

  function rate(v) {
    return '<bdi dir="ltr">' + v.toFixed(4) + "</bdi>";
  }

  function count(v) {
    return Math.round(v).toLocaleString("en-US");
  }

  /**
   * Progressive monthly volume tiers.
   * tiers = [[from, to, rate, kind], ...] where `to === null` means "and up".
   * Each band is charged at its own rate — the discount never applies
   * retroactively to messages already billed at a higher rate.
   */
  function tierCost(messages, tiers) {
    if (!tiers || !tiers.length) return { cost: 0, bands: [] };
    var left = messages;
    var prevUpper = 0;
    var cost = 0;
    var bands = [];
    for (var i = 0; i < tiers.length && left > 0; i++) {
      var upper = tiers[i][1] === null ? Infinity : tiers[i][1];
      var rate = tiers[i][2];
      var capacity = upper - prevUpper;
      var take = Math.min(left, capacity);
      if (take > 0) {
        cost += take * rate;
        bands.push({ take: take, rate: rate, discount: tiers[i][3] });
        left -= take;
      }
      prevUpper = upper;
    }
    return { cost: cost, bands: bands };
  }

  function bandNote(bands) {
    if (!bands.length) return "—";
    if (bands.length === 1) {
      return count(bands[0].take) + " رسالة بسعر القائمة " + rate(bands[0].rate);
    }
    var parts = bands.map(function (b) {
      return count(b.take) + " بسعر " + rate(b.rate);
    });
    var last = bands[bands.length - 1];
    var pct = Math.round(Math.abs(parseFloat(last.discount)) * 100);
    return parts.join(" ثم ") + " · وصلت شريحة خصم " + pct + "٪";
  }

  function fillMarkets() {
    var sel = el("market");
    var names = Object.keys(MARKETS);
    names.sort(function (a, b) {
      var ia = PRIORITY.indexOf(a), ib = PRIORITY.indexOf(b);
      if (ia === -1 && ib === -1) return MARKETS[a].ar.localeCompare(MARKETS[b].ar, "ar");
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    names.forEach(function (key) {
      var m = MARKETS[key];
      var o = document.createElement("option");
      o.value = key;
      o.textContent = m.ar + " — " + (m.mkt || 0).toFixed(4) + " دولار للتسويق";
      if (key === "Egypt") o.selected = true;
      sel.appendChild(o);
    });
  }

  function render() {
    var key = el("market").value;
    var m = MARKETS[key] || MARKETS.Egypt;
    var numbers = Math.max(1, Math.round(num("numbers")));

    var mktTotal = Math.round(num("mkt"));
    var mktFep = Math.min(Math.round(num("mktFep")), mktTotal);
    var utilTotal = Math.round(num("util"));
    var authTotal = Math.round(num("auth"));
    var svcTotal = Math.round(num("svc"));
    var agentTotal = Math.round(num("agent"));
    var fx = num("fx") || 55.37;

    // --- free allowances -------------------------------------------------
    var svcFree = Math.min(svcTotal, 1000 * numbers);
    var svcBillable = Math.max(0, svcTotal - svcFree);
    var mktBillable = Math.max(0, mktTotal - mktFep);

    // --- charges ---------------------------------------------------------
    var mktCost = mktBillable * m.mkt;
    var util = tierCost(utilTotal, m.tiers.util);
    var auth = tierCost(authTotal, m.tiers.auth);
    var svcCost = svcBillable * m.service;
    var agentCost = agentTotal * AGENT_PER_MSG;

    var total = mktCost + util.cost + auth.cost + svcCost + agentCost;
    var billableMessages = mktBillable + utilTotal + authTotal + svcBillable + agentTotal;
    var allMessages = mktTotal + utilTotal + authTotal + svcTotal + agentTotal;

    // --- totals ----------------------------------------------------------
    el("out-usd").innerHTML = usd(total);
    el("out-egp").innerHTML = egp(total * fx);
    el("out-meta").textContent =
      count(allMessages) + " رسالة في الشهر · " +
      count(billableMessages) + " منها محسوبة" +
      (billableMessages ? " · متوسط " + (total / billableMessages * 100).toFixed(1).replace(".0", "") + " سنت للرسالة" : "");

    // --- bars ------------------------------------------------------------
    var rows = [
      { key: "marketing", label: LABELS.marketing, cost: mktCost,
        sub: count(mktBillable) + " رسالة محسوبة بسعر " + rate(m.mkt) +
             (mktFep ? " · معاها " + count(mktFep) + " مجانية من إعلان" : "") },
      { key: "utility", label: LABELS.utility, cost: util.cost,
        sub: utilTotal ? bandNote(util.bands) : "—" },
      { key: "authentication", label: LABELS.authentication, cost: auth.cost,
        sub: authTotal ? bandNote(auth.bands) : "—" },
      { key: "service", label: LABELS.service, cost: svcCost,
        sub: svcBillable
          ? count(svcBillable) + " رسالة محسوبة بسعر " + rate(m.service) + " · و" + count(svcFree) + " مجانية"
          : count(svcFree) + " رسالة — كلها جوه المجاني" },
      { key: "agent", label: LABELS.agent, cost: agentCost,
        sub: agentTotal ? count(agentTotal) + " رسالة بسعر تقريبي " + rate(AGENT_PER_MSG) : "—" }
    ];

    var barsHtml = "";
    rows.forEach(function (r) {
      var pct = total > 0 ? (r.cost / total) * 100 : 0;
      barsHtml += '<span style="width:' + pct.toFixed(2) + "%;background:" + COLORS[r.key] +
        '" title="' + r.label + '"></span>';
    });
    el("bars").innerHTML = barsHtml;

    var bdHtml = "";
    rows.forEach(function (r) {
      var pct = total > 0 ? Math.round((r.cost / total) * 100) : 0;
      bdHtml += '<li>' +
        '<span class="bd-name"><i style="background:' + COLORS[r.key] + '"></i>' + r.label + "</span>" +
        '<span class="bd-amount">' + usd(r.cost) + "</span>" +
        '<span class="bd-sub">' + r.sub + (r.cost > 0 ? " · " + pct + "٪ من الفاتورة" : "") + "</span>" +
        "</li>";
    });
    el("breakdown").innerHTML = bdHtml;

    // --- savings ---------------------------------------------------------
    var savedSvc = svcFree * m.service;
    var savedFep = mktFep * m.mkt;
    var savHtml = "";
    if (savedFep > 0) {
      savHtml += "<div><span>وفّرت من نافذة الإعلان (FEP)</span><b>" + usd(savedFep) + "</b></div>";
    }
    if (savedSvc > 0) {
      savHtml += "<div><span>وفّرت من 1000 رسالة الخدمة المجانية</span><b>" + usd(savedSvc) + "</b></div>";
    }
    if (savedFep + savedSvc > 0) {
      savHtml += "<div><span>إجمالي اللي اتوفّر الشهر ده</span><b>" + usd(savedFep + savedSvc) + " · " + egp((savedFep + savedSvc) * fx) + "</b></div>";
    }
    el("savings").innerHTML = savHtml;

    // --- hint on FX ------------------------------------------------------
    el("fx-hint").innerHTML = "1 دولار = " + fx + " ج.م · الشهر كله " + egp(total * fx);
  }

  var PRESETS = {
    shop:     { numbers: 1, mkt: 2000, mktFep: 500, util: 800, auth: 200, svc: 1500, agent: 0 },
    service:  { numbers: 2, mkt: 200, mktFep: 0, util: 300, auth: 0, svc: 9000, agent: 0 },
    campaign: { numbers: 1, mkt: 20000, mktFep: 8000, util: 1500, auth: 0, svc: 2000, agent: 0 }
  };

  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return;
    Object.keys(p).forEach(function (k) { el(k).value = p[k]; });
    render();
  }

  function init() {
    fillMarkets();
    el("year").textContent = new Date().getFullYear();

    var form = el("calc-form");
    form.addEventListener("input", render);
    form.addEventListener("change", render);

    Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"), function (b) {
      b.addEventListener("click", function () { applyPreset(b.getAttribute("data-preset")); });
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
