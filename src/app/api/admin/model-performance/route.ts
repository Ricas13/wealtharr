import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { authFailure } from "@/lib/api-auth";
import { benchmarkMetadata } from "@/domain/benchmark-evidence";

const rowSchema=z.object({
  date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value:z.string(),
  benchmarkValue:z.string().nullable().optional()
});
const benchmarkPointSchema=z.object({
  date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value:z.string()
});
const benchmarkSeriesSchema=z.object({
  key:z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-_]*$/i),
  name:z.string().min(1).max(120),
  economicExposure:z.string().min(1).max(120),
  description:z.string().max(500).optional().default(""),
  label:z.string().min(1).max(80).optional(),
  sortOrder:z.number().int().min(0).max(1000).optional().default(0),
  defaultVisible:z.boolean().optional().default(false),
  currency:z.string().length(3).optional(),
  provider:z.string().min(3).max(120).optional(),
  totalReturnAdjusted:z.boolean().optional().default(false),
  commercialLicenceConfirmed:z.boolean().optional().default(false),
  fxConversionVerified:z.boolean().optional().default(false),
  points:z.array(benchmarkPointSchema).min(1).max(5000)
});
const schema=z.object({
  strategyVersionId:z.string().uuid(),
  points:z.array(rowSchema).min(1).max(5000),
  source:z.string().max(80).default("ADMIN"),
  benchmarks:z.array(benchmarkSeriesSchema).max(8).optional().default([])
});

export async function PUT(request:Request){
  try{
    assertSameOrigin(request);
    const admin=await requireAdmin();
    const input=schema.parse(await request.json());

    await sql.begin(async(tx)=>{
      for(const point of input.points){
        await tx.unsafe(
          "INSERT INTO canonical_model_performance (strategy_version_id,date,value,benchmark_value,source,metadata) VALUES ($1,$2,$3,$4,$5,'{}'::jsonb)" +
          " ON CONFLICT (strategy_version_id,date) DO UPDATE SET value=EXCLUDED.value,benchmark_value=EXCLUDED.benchmark_value,source=EXCLUDED.source",
          [input.strategyVersionId,point.date,point.value,point.benchmarkValue??null,input.source]
        );
      }

      for(const series of input.benchmarks){
        const benchmarkRows=await tx.unsafe(
          "INSERT INTO benchmarks (key,name,economic_exposure,description) VALUES ($1,$2,$3,$4)"+
          " ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name,economic_exposure=EXCLUDED.economic_exposure,description=EXCLUDED.description RETURNING id",
          [series.key,series.name,series.economicExposure,series.description]
        );
        const benchmarkId=String(benchmarkRows[0].id);
        const metadata=benchmarkMetadata(series);
        await tx.unsafe(
          "INSERT INTO strategy_version_benchmarks (strategy_version_id,benchmark_id,label,sort_order,default_visible) VALUES ($1,$2,$3,$4,$5)"+
          " ON CONFLICT (strategy_version_id,benchmark_id) DO UPDATE SET label=EXCLUDED.label,sort_order=EXCLUDED.sort_order,default_visible=EXCLUDED.default_visible",
          [input.strategyVersionId,benchmarkId,series.label??series.name,series.sortOrder,series.defaultVisible]
        );
        for(const point of series.points){
          await tx.unsafe(
            "INSERT INTO benchmark_performance (benchmark_id,date,value,source,metadata) VALUES ($1,$2,$3,$4,$5::jsonb)"+
            " ON CONFLICT (benchmark_id,date) DO UPDATE SET value=EXCLUDED.value,source=EXCLUDED.source,metadata=EXCLUDED.metadata",
            [benchmarkId,point.date,point.value,input.source,JSON.stringify(metadata)]
          );
        }
      }

      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'model-performance.upsert','strategy_version',$2,$3::jsonb)",
        [admin.id,input.strategyVersionId,JSON.stringify({points:input.points.length,benchmarkSeries:input.benchmarks.map((series)=>({key:series.key,points:series.points.length}))})]
      );
    });
    return Response.json({ok:true});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Invalid model performance payload."},{status:400});
    return Response.json({error:"Could not update model performance."},{status:500});
  }
}
